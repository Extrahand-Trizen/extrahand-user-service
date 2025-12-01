# ExtraHand User Service

User Service for the ExtraHand Platform - Handles authentication, profiles, and user-related operations.

## Port
**4001**

## Features
- ✅ Authentication (Firebase Auth integration)
- ✅ Profile Management (CRUD operations)
- ✅ Business Profiles
- ✅ Profile Image Uploads
- ✅ Privacy & Consent Management
- ✅ User Search

## Tech Stack
- TypeScript
- Express.js
- MongoDB (Mongoose)
- Firebase Admin SDK
- Winston (Logging)
- Zod (Validation)

## Getting Started

### Prerequisites
- Node.js >= 18
- MongoDB
- Firebase Project

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/signup` - User signup
- `POST /api/v1/auth/logout` - User logout
- `GET /api/v1/auth/verify` - Verify token

### Profiles
- `GET /api/v1/profiles/me` - Get current user profile
- `PUT /api/v1/profiles/me` - Update current user profile
- `GET /api/v1/profiles/:id` - Get user profile by ID
- `GET /api/v1/profiles/search` - Search profiles

### Business Profiles
- `GET /api/v1/business/me` - Get current user's business profile
- `POST /api/v1/business` - Create business profile
- `PUT /api/v1/business/:id` - Update business profile

### Uploads
- `POST /api/v1/uploads/profile-picture` - Upload profile picture

## Service Communication

This service communicates with:
- **Task Service** (Port 4002) - For task-related user operations
- **Messaging Service** (Port 4006) - For user messaging
- **Verification Service** (Port 4004) - For user verification status

## Architecture

```
src/
├── config/          # Configuration (env, database, logger)
├── controllers/     # Request handlers
├── services/        # Business logic
├── middleware/      # Express middleware
├── routes/          # Route definitions
├── models/          # Mongoose models
├── types/           # TypeScript types
├── utils/           # Utility functions
├── errors/          # Custom error classes
├── app.ts           # Express app setup
└── server.ts        # Server entry point
```

