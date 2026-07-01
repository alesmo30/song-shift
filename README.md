# Node.js Express API with Prisma and Passport

A robust backend API built with Express 5, Prisma 7, and Passport.js, featuring JWT authentication, Role-Based Access Control (RBAC), and PostgreSQL.

## Features

- **Authentication**: JWT-based authentication using Passport.js.
- **Authorization**: Role-Based Access Control (RBAC) with `ADMIN` and `USER` roles.
- **ORM**: Prisma 7 for database management and type-safe queries.
- **Validation**: Request body validation using Joi.
- **Security**: Security headers with Helmet and password hashing with Bcryptjs.
- **Error Handling**: Centralized error handling middleware with custom error classes.
- **Logging**: Asynchronous logging with Winston.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express 5
- **Database**: PostgreSQL
- **ORM**: Prisma 7
- **Authentication**: Passport.js (JWT Strategy)
- **Validation**: Joi
- **Logging**: Winston

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- PostgreSQL database

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd project
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   Create a `.env` file in the root directory and add the following variables:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/dbname?schema=public"
   DIRECT_URL="postgresql://user:password@localhost:5432/dbname?schema=public"
   JWT_ACCESS_TOKEN_SECRET="your_access_token_secret"
   JWT_REFRESH_TOKEN_SECRET="your_refresh_token_secret"
   ```

### Database Setup

This project uses Prisma 7. Initialize the database and generate the Prisma client:

```bash
# Generate Prisma client
./node_modules/.bin/prisma generate

# Run migrations
./node_modules/.bin/prisma migrate dev --name init
```

*Note: Always use `./node_modules/.bin/prisma` directly as `npx prisma` may hang in certain environments.*

### Running the Application

Start the server in development mode with nodemon:

```bash
npm start
```

The server will be running on `http://localhost:3000`.

## API Endpoints

### Authentication
- `POST /login`: Authenticate a user and receive access and refresh tokens.

### Users
- `POST /users`: Create a new user (Admin only).
- `GET /users/:id`: Retrieve user details by ID (Authenticated).

## Project Structure

- `index.js`: Application entry point.
- `server.js`: Express application configuration and middleware registration.
- `router/`: API route definitions.
- `services/`: Business logic layer.
- `middlewares/`: Custom middlewares (auth, validation, error handling).
- `prisma/`: Prisma schema and migrations.
- `lib/`: Database client initialization (Prisma singleton).
- `utils/`: Utility functions, constants, and logging configuration.

## License

This project is licensed under the ISC License.
