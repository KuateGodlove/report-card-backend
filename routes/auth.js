const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../lib/prisma');
const { comparePassword, generateToken, verifyToken } = require('../lib/auth');

const oauthProviders = {
  google: {
    clientId: 'GOOGLE_CLIENT_ID',
    clientSecret: 'GOOGLE_CLIENT_SECRET',
    callbackUrl: 'GOOGLE_CALLBACK_URL',
  },
  facebook: {
    clientId: 'FACEBOOK_CLIENT_ID',
    clientSecret: 'FACEBOOK_CLIENT_SECRET',
    callbackUrl: 'FACEBOOK_CALLBACK_URL',
  },
};

function oauthConfig(provider) {
  const names = oauthProviders[provider];
  if (!names) return null;
  const config = {
    clientId: process.env[names.clientId],
    clientSecret: process.env[names.clientSecret],
    callbackUrl: process.env[names.callbackUrl],
  };
  return Object.values(config).every(Boolean) ? config : null;
}

function stateCookieName(provider) {
  return `oauth_state_${provider}`;
}

function setStateCookie(res, provider, state) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${stateCookieName(provider)}=${state}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=600${secure}`);
}

function clearStateCookie(res, provider) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${stateCookieName(provider)}=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0${secure}`);
}

function getCookie(req, name) {
  const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}

function frontendLoginUrl(fragment) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')[0].trim().replace(/\/$/, '');
  return `${frontendUrl}/login#${fragment}`;
}

function redirectOAuthError(res, error) {
  return res.redirect(frontendLoginUrl(`social_error=${encodeURIComponent(error)}`));
}

async function findAccountByEmail(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const [teacher, studentAccount, parentAccount] = await Promise.all([
    prisma.teacher.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } }),
    prisma.studentAccount.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      include: { student: true },
    }),
    prisma.parentAccount.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } }),
  ]);

  const matches = [teacher, studentAccount, parentAccount].filter(Boolean);
  if (matches.length !== 1) return null;

  if (teacher) {
    return { id: teacher.id, email: teacher.email, fullName: teacher.fullName, role: teacher.role };
  }
  if (studentAccount) {
    return {
      id: studentAccount.id,
      studentId: studentAccount.studentId,
      email: studentAccount.email,
      fullName: studentAccount.student.fullName,
      role: 'STUDENT',
    };
  }
  return { id: parentAccount.id, email: parentAccount.email, fullName: parentAccount.fullName, role: 'PARENT' };
}

function authorizationUrl(provider, config, state) {
  const url = provider === 'google'
    ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
    : new URL('https://www.facebook.com/v23.0/dialog/oauth');
  const params = {
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    state,
  };
  if (provider === 'google') {
    params.scope = 'openid email profile';
    params.prompt = 'select_account';
  } else {
    params.scope = 'email,public_profile';
  }
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

async function exchangeOAuthCode(provider, config, code) {
  const tokenUrl = provider === 'google'
    ? 'https://oauth2.googleapis.com/token'
    : 'https://graph.facebook.com/v23.0/oauth/access_token';
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      code,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token) throw new Error('OAuth token exchange failed');

  const profileUrl = provider === 'google'
    ? 'https://www.googleapis.com/oauth2/v2/userinfo'
    : 'https://graph.facebook.com/me?fields=id,name,email';
  const profileResponse = await fetch(profileUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileResponse.json();
  if (!profileResponse.ok) throw new Error('Could not load the provider profile');
  if (provider === 'google' && profile.verified_email !== true) {
    throw new Error('Google did not provide a verified email address');
  }
  if (!profile.email) throw new Error('The provider did not return an email address');
  return profile;
}

for (const provider of Object.keys(oauthProviders)) {
  router.get(`/${provider}`, (req, res) => {
    const config = oauthConfig(provider);
    if (!config) return res.status(503).send(`${provider} sign-in is not configured.`);
    const state = crypto.randomBytes(32).toString('hex');
    setStateCookie(res, provider, state);
    return res.redirect(authorizationUrl(provider, config, state));
  });

  router.get(`/${provider}/callback`, async (req, res) => {
    const expectedState = getCookie(req, stateCookieName(provider));
    clearStateCookie(res, provider);
    const config = oauthConfig(provider);
    if (!config) return redirectOAuthError(res, 'social_login_unavailable');

    const receivedState = typeof req.query.state === 'string' ? req.query.state : '';
    const validState = expectedState.length === receivedState.length && expectedState.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(expectedState), Buffer.from(receivedState));
    if (!validState) return redirectOAuthError(res, 'social_login_invalid_state');
    if (req.query.error || typeof req.query.code !== 'string') {
      return redirectOAuthError(res, 'social_login_cancelled');
    }

    try {
      const profile = await exchangeOAuthCode(provider, config, req.query.code);
      const user = await findAccountByEmail(profile.email);
      if (!user) return redirectOAuthError(res, 'social_login_account_not_found');

      const token = generateToken({
        id: user.id,
        email: user.email,
        role: user.role,
        ...(user.studentId ? { studentId: user.studentId } : {}),
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(frontendLoginUrl(`token=${encodeURIComponent(token)}`));
    } catch (error) {
      console.error(`${provider} sign-in error:`, error.message);
      return redirectOAuthError(res, 'social_login_failed');
    }
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Staff accounts use the Teacher table.
    const teacher = await prisma.teacher.findUnique({
      where: { email },
    });

    if (teacher) {
      const isValid = await comparePassword(password, teacher.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = generateToken({
        id: teacher.id,
        email: teacher.email,
        role: teacher.role, // ADMIN or TEACHER
      });

      return res.json({
        token,
        user: {
          id: teacher.id,
          fullName: teacher.fullName,
          email: teacher.email,
          role: teacher.role,
        },
      });
    }

    const studentAccount = await prisma.studentAccount.findUnique({
      where: { email },
      include: { student: true },
    });

    if (studentAccount) {
      const isValid = await comparePassword(password, studentAccount.passwordHash);
      if (!isValid) return res.status(401).json({ error: 'Invalid email or password' });

      const user = {
        id: studentAccount.id,
        studentId: studentAccount.studentId,
        fullName: studentAccount.student.fullName,
        email: studentAccount.email,
        role: 'STUDENT',
      };
      return res.json({ token: generateToken(user), user });
    }

    const parentAccount = await prisma.parentAccount.findUnique({ where: { email } });
    if (parentAccount) {
      const isValid = await comparePassword(password, parentAccount.passwordHash);
      if (!isValid) return res.status(401).json({ error: 'Invalid email or password' });

      const user = {
        id: parentAccount.id,
        fullName: parentAccount.fullName,
        email: parentAccount.email,
        role: 'PARENT',
      };
      return res.json({ token: generateToken(user), user });
    }

    // No matching user found
    return res.status(401).json({ error: 'Invalid email or password' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/me', async (req, res) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });

  try {
    const user = await findAccountByEmail(decoded.email);
    if (!user || user.id !== decoded.id || user.role !== decoded.role) {
      return res.status(401).json({ error: 'Account not found' });
    }
    return res.json({ user });
  } catch (error) {
    console.error('Session lookup error:', error);
    return res.status(500).json({ error: 'Could not load account' });
  }
});

module.exports = router;