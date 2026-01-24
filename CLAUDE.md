# BookPlayer API - Developer Guide

This document provides a comprehensive overview of the BookPlayer API backend for new developers.

## Quick Start

```bash
# Install dependencies
yarn install

# Set up environment (copy and edit)
cp development.env.template .development.env

# Run in development mode (auto-reload)
yarn dev

# Server runs at http://localhost:5003
# Health check: GET /v1/status
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Express Application                       │
│      (Auth, CORS, Helmet, Compression, Version middlewares) │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Router Layer (/src/api/)                   │
│   UserRouter │ PasskeyRouter │ LibraryRouter │ AdminRouter  │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│             Controller Layer (/src/controllers/)            │
│    Handle HTTP request/response, call services              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Service Layer (/src/services/)                 │
│    Business logic, database queries, external APIs          │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         PostgreSQL       Redis         External
          (Knex)        (Cache)      (AWS, Apple,
                                     RevenueCat)
```

## Project Structure

```
src/
├── main.ts                 # Entry point
├── server.ts               # Express app setup
├── container.ts            # Dependency injection bindings
├── ContainerTypes.ts       # DI symbols
├── config/
│   └── envs.ts            # Environment validation
├── api/
│   ├── RouterHttp.ts      # Main router (mounts all routes)
│   ├── UserRouter.ts      # /v1/user routes
│   ├── PasskeyRouter.ts   # /v1/passkey routes
│   ├── LibraryRouter.ts   # /v1/library routes
│   ├── AdminRouter.ts     # /v1/admin routes
│   ├── StorageRouter.ts   # /v1/storage routes
│   ├── RetentionMessagingRouter.ts  # /v1/retention routes
│   └── middlewares/
│       ├── auth.ts        # JWT validation
│       ├── version.ts     # App version check
│       ├── subscription.ts # Subscription check
│       └── admin.ts       # Admin permission check
├── controllers/           # HTTP handlers
├── services/              # Business logic
├── interfaces/            # TypeScript interfaces (I* prefix)
├── types/                 # Type definitions
├── database/
│   ├── index.ts          # Knex connection
│   └── migrations/       # Database migrations
└── utils/                # Shared utilities
```

## Dependency Injection (Inversify)

All components use Inversify for dependency injection.

### Adding a New Service

1. **Create the interface** (`src/interfaces/IMyService.ts`):
```typescript
export interface IMyService {
  DoSomething(param: string): Promise<Result>;
}
```

2. **Create the service** (`src/services/MyService.ts`):
```typescript
import { injectable, inject } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { ILoggerService } from '../interfaces/ILoggerService';

@injectable()
export class MyService implements IMyService {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;

  private db = database;

  async DoSomething(param: string): Promise<Result> {
    try {
      // Business logic here
      return result;
    } catch (err) {
      this._logger.log({
        origin: 'MyService.DoSomething',
        message: err.message,
        data: { param }
      });
      return null;
    }
  }
}
```

3. **Add symbol** (`src/ContainerTypes.ts`):
```typescript
const TYPES = {
  // ...existing types
  MyService: Symbol.for('MyService'),
};
```

4. **Register binding** (`src/container.ts`):
```typescript
import { IMyService } from './interfaces/IMyService';
import { MyService } from './services/MyService';

container.bind<IMyService>(TYPES.MyService).to(MyService);
```

5. **Inject in controller**:
```typescript
@injectable()
export class MyController {
  @inject(TYPES.MyService)
  private _myService: IMyService;
}
```

## Request Flow

### 1. Middleware Pipeline (server.ts)

```typescript
app.use(bodyParser.json());           // Parse JSON
app.use(compress());                   // Gzip compression
app.use(helmet());                     // Security headers
app.use(authMiddleware);              // JWT validation → sets req.user
app.use(versionMiddleware.check());   // Version compatibility
app.use('/v1', routerHttp.get());     // Mount routes
app.use(handleError);                 // Global error handler
```

### 2. Auth Middleware

The auth middleware (`src/api/middlewares/auth.ts`):
- Extracts JWT from `Authorization: Bearer <token>` header or cookie
- Verifies signature with `APP_SECRET`
- Sets `req.user = { id_user, email, external_id, time }`
- Non-blocking: continues even if token is invalid

### 3. Controller Pattern

```typescript
@injectable()
export class UserController implements IUserController {
  @inject(TYPES.UserServices)
  private _userService: IUserService;

  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;

  public async InitLogin(req: IRequest, res: IResponse): Promise<IResponse> {
    try {
      const { token_id } = req.body;

      // Validation
      if (!token_id) {
        return res.status(422).json({ message: 'Token required' });
      }

      // Business logic via service
      const user = await this._userService.verifyToken(token_id);

      // Response
      return res.json({ email: user.email, token: user.token });
    } catch (err) {
      this._logger.log({ origin: 'InitLogin', message: err.message });
      return res.status(400).json({ message: err.message });
    }
  }
}
```

## Database (Knex + PostgreSQL)

### Connection

```typescript
import database from '../database';

@injectable()
export class MyService {
  private db = database;

  async getUser(email: string) {
    return this.db('users')
      .where({ email, active: true })
      .first();
  }
}
```

### Common Query Patterns

```typescript
// Simple select
const user = await this.db('users').where({ id_user }).first();

// Insert with returning
const [newUser] = await this.db('users')
  .insert({ email, password: '' })
  .returning('*');

// Update
await this.db('users')
  .where({ id_user })
  .update({ active: false, updated_at: new Date() });

// Join
const items = await this.db('library_items as li')
  .select('li.*', 'b.note')
  .leftJoin('bookmarks as b', 'li.id', 'b.library_item_id')
  .where({ 'li.user_id': userId });

// Transaction
const tx = await this.db.transaction();
try {
  await tx('users').insert({ ... });
  await tx('user_params').insert({ ... });
  await tx.commit();
} catch (err) {
  await tx.rollback();
  throw err;
}
```

### Migrations

```bash
# Create migration
npx knex migrate:make migration_name

# Run migrations
npx knex migrate:latest

# Rollback
npx knex migrate:rollback
```

## API Endpoints

### User Routes (`/v1/user`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | Check auth status | Optional |
| POST | `/login` | Apple ID login | No |
| GET | `/logout` | Logout | Yes |
| POST | `/second_onboarding` | Onboarding flow | Yes |
| POST | `/events` | Track user events | Yes |
| POST | `/revenuecat` | Subscription webhook | Header |
| DELETE | `/delete` | Delete account | Yes |

### Passkey Routes (`/v1/passkey`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/register/options` | Get registration challenge | Yes |
| POST | `/register/verify` | Complete registration | Yes |
| POST | `/auth/options` | Get auth challenge | No |
| POST | `/auth/verify` | Complete authentication | No |
| GET | `/devices` | List user's passkeys | Yes |
| DELETE | `/devices/:id` | Delete passkey | Yes |
| PUT | `/devices/:id` | Rename passkey | Yes |

### Library Routes (`/v1/library`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/all` | Get full library | Yes |
| GET | `/history/:id` | Get library item | Yes |
| POST | `/sync` | Sync library items | Yes |
| POST | `/sync-legacy` | Legacy sync | Yes |

### Storage Routes (`/v1/storage`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/items` | List S3 objects | Yes |
| GET | `/url` | Get presigned URL | Yes |
| POST | `/upload` | Upload file | Yes |

### Admin Routes (`/v1/admin`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/users/stats` | User statistics | Admin |
| GET | `/books` | All books | Admin |
| PUT | `/sync/:id` | Update sync status | Admin |

### Retention Routes (`/v1/retention`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/` | Apple retention webhook | Apple JWS |

## Authentication Methods

### 1. Apple Sign-In

```typescript
// iOS app sends Apple ID token
POST /v1/user/login
{ "token_id": "eyJ..." }

// Backend verifies with Apple, creates/finds user
// Returns JWT token
{ "email": "user@icloud.com", "token": "eyJ..." }
```

### 2. Passkey (WebAuthn)

```typescript
// Registration
POST /v1/passkey/register/options  // Get challenge
POST /v1/passkey/register/verify   // Submit attestation

// Authentication
POST /v1/passkey/auth/options      // Get challenge (with email)
POST /v1/passkey/auth/verify       // Submit assertion
```

### 3. Email Verification

```typescript
// Request code
POST /v1/user/email/verify { "email": "user@example.com" }

// Verify code
POST /v1/user/email/confirm { "email": "...", "code": "123456" }
```

## External Services

### AWS S3

```typescript
@inject(TYPES.S3Service)
private _s3: IS3Service;

// List objects
const items = await this._s3.listObjects(prefix);

// Get presigned URL (60s expiry)
const url = await this._s3.getPresignedUrl(key);

// Check existence
const exists = await this._s3.objectExists(key);
```

### Redis Cache

```typescript
@inject(TYPES.CacheService)
private _cache: ICacheService;

// Store object
await this._cache.setObject('key', { data }, ttlSeconds);

// Retrieve
const data = await this._cache.getObject('key');

// Delete
await this._cache.deleteObject('key');
```

### RevenueCat

```typescript
// Webhook handling (SubscriptionService)
const event = req.body.event as RevenuecatEvent;
const user = await this._subscriptionService.ParseNewEvent(event);
await this._subscriptionService.GetAndUpdateSubscription(user);

// Check subscription status
const hasSubscription = await this._subscriptionService.HasInAppPurchase(rc_id);
```

## Error Handling

### Service Level

```typescript
async DoSomething(): Promise<Result | null> {
  try {
    // Logic
    return result;
  } catch (err) {
    this._logger.log({
      origin: 'ServiceName.DoSomething',
      message: err.message,
      data: { relevantData }
    });
    return null;  // Return null on error
  }
}
```

### Controller Level

```typescript
public async Handler(req: IRequest, res: IResponse): Promise<IResponse> {
  try {
    // Validation
    if (!req.body.required) {
      return res.status(422).json({ message: 'Field required' });
    }

    // Business logic
    const result = await this._service.DoSomething();

    if (!result) {
      return res.status(400).json({ message: 'Operation failed' });
    }

    return res.json(result);
  } catch (err) {
    this._logger.log({ origin: 'Handler', message: err.message }, 'error');
    return res.status(500).json({ message: 'Internal error' });
  }
}
```

### HTTP Status Codes

| Code | Usage |
|------|-------|
| 200 | Success |
| 400 | Bad request / Operation failed |
| 403 | Forbidden (auth failed) |
| 409 | Conflict (duplicate) |
| 422 | Validation error |
| 500 | Server error |

## Logging

```typescript
@inject(TYPES.LoggerService)
private _logger: ILoggerService;

// Info (default)
this._logger.log({
  origin: 'ClassName.methodName',
  message: 'What happened',
  data: { userId, action }
});

// Error
this._logger.log({
  origin: 'ClassName.methodName',
  message: err.message,
  data: { context }
}, 'error');

// Warning
this._logger.log({
  origin: 'ClassName.methodName',
  message: 'Warning message'
}, 'warn');
```

**Note:** Sensitive fields (`password`, `token`, `secret`, `authorization`) are automatically redacted.

## Testing

```bash
# Run all tests
yarn test

# Watch mode
yarn test:watch

# Coverage report
yarn test:coverage
```

### Test Structure

```typescript
// src/__tests__/services/MyService.test.ts
import { MyService } from '../../services/MyService';

describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    service = new MyService();
    // Setup mocks
  });

  afterEach(async () => {
    // Cleanup
  });

  it('should do something', async () => {
    const result = await service.DoSomething('param');
    expect(result).toBeDefined();
  });
});
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | development / production |
| `API_PORT` | Server port (default: 5003) |
| `DB_HOST` | PostgreSQL host |
| `DB_USER` | PostgreSQL user |
| `DB_PASSWORD` | PostgreSQL password |
| `DB_DATABASE` | PostgreSQL database name |
| `APP_SECRET` | JWT signing secret |
| `S3_BUCKET` | AWS S3 bucket name |
| `S3_REGION` | AWS S3 region |
| `APPLE_CLIENT_ID` | Apple Sign-In client ID |
| `REVENUECAT_HEADER` | RevenueCat webhook header |
| `REVENUECAT_API` | RevenueCat API URL |
| `REVENUECAT_KEY` | RevenueCat API key |

### Optional

| Variable | Description |
|----------|-------------|
| `LOG_LEVEL` | debug / info / warn / error |
| `REDIS_URL` | Redis connection URL |
| `CORS_ORIGIN` | Allowed CORS origins |

## Common Tasks

### Adding a New Endpoint

1. Add route in appropriate router (`src/api/*Router.ts`)
2. Add controller method (`src/controllers/*Controller.ts`)
3. Add service method if needed (`src/services/*Service.ts`)
4. Update interface if adding new methods

### Adding a New Database Table

1. Create migration: `npx knex migrate:make create_table_name`
2. Define schema in migration file
3. Run migration: `npx knex migrate:latest`
4. Add TypeScript types in `src/types/`

### Adding a New Environment Variable

1. Add to `development.env.template`
2. Add validation in `src/config/envs.ts` if required
3. For production: Add to AWS Secrets Manager
4. For ECS: Add to `docker/ecs/task-definition.json`

## Deployment

See `docker/ecs/README.md` for deployment instructions.

**Quick deploy:**
1. Push changes to repository
2. Go to GitHub Actions → "Deploy to ECS" → Run workflow

## Key Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20.x | Runtime |
| TypeScript | 4.5.5 | Language |
| Express | 4.17.2 | HTTP framework |
| Inversify | 6.0.1 | Dependency injection |
| Knex.js | 1.0.2 | Database query builder |
| PostgreSQL | - | Database |
| Redis | 4.3.0 | Caching |
| Jest | 29.7.0 | Testing |
| Winston | 3.9.0 | Logging |

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Interfaces | `I` prefix | `IUserService` |
| Services | PascalCase | `UserServices` |
| Controllers | PascalCase + Controller | `UserController` |
| Routers | PascalCase + Router | `UserRouter` |
| Methods (services) | PascalCase | `GetUser`, `AddNewUser` |
| Methods (controllers) | PascalCase | `InitLogin`, `DeleteAccount` |
| Private properties | `_` prefix | `_userService`, `_logger` |
| Database tables | snake_case | `user_params`, `library_items` |
| Environment vars | SCREAMING_SNAKE | `DB_HOST`, `APP_SECRET` |
