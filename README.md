# API Gateway

Simulates a cloud API gateway service (such as AWS API Gateway or Kong) with routing, authentication, rate limiting, and analytics.

## Overview

The API Gateway project is a reverse proxy and API management platform that demonstrates core cloud gateway concepts. It provides dynamic route dispatching, configurable upstream latency and failure simulations, API key validation, fixed-window rate limiting, and response caching. It logs every transaction to provide real-time metrics on throughput, status distributions, latency, and cache hit ratios.

## Features

- Dynamic route configuration supporting specific HTTP methods or wildcard ANY matching
- Public gateway proxy engine (`/gw/*`) routing to mock upstream services (`echo`, `time`, `users`, `flaky`)
- API key authentication with SHA-256 hashed verification, prefix masking, and instant key revocation
- Fixed-window rate limiting per route and API key, returning standard `X-RateLimit-*` and `Retry-After` headers
- In-database response caching for GET requests with custom TTL and `X-Cache` hit/miss status
- Configurable upstream latency simulation and flaky upstream error injection
- Real-time analytics tracking requests per minute, status code breakdown, cache efficiency, and route latency
- Interactive API testing console with live request inspection and execution history

## Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | Next.js 14 + TypeScript + Tailwind |
| Backend | Node.js + Express |
| Database | PostgreSQL 16 |
| Auth | JWT |
| Container | Docker Compose |

## Project Structure

```
api-gateway/
├── backend/
├── database/
│   └── init.sql
├── docker-compose.yml
└── frontend/
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### Option A: Docker Compose

1. From the `api-gateway` directory, run:
   ```bash
   docker compose up --build
   ```
2. Access the applications:
   - Frontend: http://localhost:3009
   - Backend: http://localhost:4009

### Option B: Local Development

1. Start the PostgreSQL database:
   ```bash
   docker compose up -d db
   ```
2. Start the backend service:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   Backend runs on http://localhost:4009.
3. Start the frontend application:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Frontend runs on http://localhost:3009.

> `database/init.sql` runs only on first container startup. To reset the database and re-run initialization, run `docker compose down -v`.

## Demo Login

- **Email**: admin@demo.com
- **Password**: demo123

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
| --- | --- |
| `PORT` | Port for Express backend server (default: 4009) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key used to sign and verify authentication JWT tokens |
| `CORS_ORIGIN` | Allowed origin for Cross-Origin Resource Sharing |

### Frontend (`frontend/.env.local`)

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL for the backend API (default: http://localhost:4009) |

*Note: The frontend reads the API URL from `NEXT_PUBLIC_API_URL` at build time, so it must be configured before building for deployment.*

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Server health check endpoint |
| POST | `/api/auth/login` | Authenticate administrator and receive JWT token |
| ALL | `/gw/*` | Public gateway invocation proxy with routing, rate limiting, and caching |
| GET | `/api/routes` | List all configured gateway routes |
| POST | `/api/routes` | Create a new routing entry |
| PUT | `/api/routes/:id` | Update an existing route configuration |
| DELETE | `/api/routes/:id` | Delete a gateway route |
| GET | `/api/keys` | List all generated API keys |
| POST | `/api/keys` | Generate a new API key with assigned rate limit |
| PATCH | `/api/keys/:id/revoke` | Revoke an active API key |
| GET | `/api/analytics` | Fetch metrics including RPM, status distribution, and latency |

## Notes

- The `/gw/*` gateway execution endpoint is public and authenticates via the `x-api-key` header rather than JWT when required by a route.
- A pre-seeded demo API key `gw_demo_free_key_1234567890abcdef` is available in `database/init.sql`.

## License

MIT
