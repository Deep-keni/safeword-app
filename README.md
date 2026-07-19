# SafeWord — Voice Journal

A minimal Next.js application setup.

## Getting Started

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) installed.

### Setup

1. Copy `.env.local.example` to `.env.local` and fill in the required environment variables:
   ```bash
   cp .env.local.example .env.local
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```

### Running Locally

To run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the result.

### API Routes

- **POST** `/api/checkSafeWord` — Validation endpoint. Currently returns `{ matched: false }` for all POST requests.
