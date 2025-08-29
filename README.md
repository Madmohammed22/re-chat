# Re-chat Application

A real-time chat application with reaction support.

## Project Structure

```
re-chat/
├── backend/                 # Backend application
│   ├── src/                # Source files
│   │   ├── db.ts          # Database operations
│   │   ├── index.ts       # Main server file
│   │   └── types.ts       # Shared type definitions
│   ├── prisma/            # Prisma configuration
│   │   ├── schema.prisma  # Database schema
│   │   └── migrations/    # Database migrations
│   ├── .env               # Environment variables
│   ├── package.json       # Backend dependencies
│   └── tsconfig.json      # TypeScript configuration
├── frontend/              # Frontend application
│   ├── src/              # Source files
│   │   ├── index.html    # Main HTML file
│   │   └── index.css     # Styles
│   ├── package.json      # Frontend dependencies
│   └── tsconfig.json     # TypeScript configuration
└── package.json          # Root package.json for managing both packages
```

## Setup

1. Install all dependencies:
   ```bash
   npm run install:all
   ```

2. Set up the database (from the backend directory):
   ```bash
   cd backend
   npx prisma migrate dev
   ```

3. Build both packages:
   ```bash
   npm run build
   ```

4. Start the application:
   ```bash
   npm run dev
   ```

This will start both the backend server and frontend development server.

## Environment Variables

The backend requires the following environment variables in `/backend/.env`:

- `DATABASE_URL`: The SQLite database URL (e.g., "file:../chat.db")

## Development

- Backend runs on port 3000 by default
- Frontend development server runs on a different port (usually 8080)
