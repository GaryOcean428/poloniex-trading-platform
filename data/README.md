# Data Directory

This directory contains raw JSON data sources and datasets for the Poloniex Trading Platform.

## Structure

```
data/
├── markets/           # Market data files
│   ├── symbols.json
│   └── historical/
├── config/            # Configuration JSON files
│   └── strategies.json
├── samples/           # Sample data for testing
│   └── test_market_data.json
└── README.md
```

## Data Validation

All JSON data must be validated before use:

### Frontend (TypeScript)
```typescript
import { z } from 'zod';

const MarketDataSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  volume: z.number(),
  timestamp: z.string(),
});

// Validate at runtime
const validatedData = MarketDataSchema.parse(jsonData);
```

### Backend (Python)
```python
from pydantic import BaseModel

class MarketData(BaseModel):
    symbol: str
    price: float
    volume: float
    timestamp: str

# Validate before passing to kernels
data = MarketData(**json_data)
```

## Data Sources

### Static Data
- Keep static reference data in this directory
- Version control appropriate for config files
- Use `.gitignore` for large historical data files

### Dynamic Data
- Seed into Neon DB during setup
- Use migrations in `packages/database/migrations/`
- Query from database during runtime

## Loading Data

### In Node.js/TypeScript
```typescript
import marketData from '@/data/markets/symbols.json';
```

### In Python
```python
import json
from pathlib import Path

data_path = Path(__file__).parent.parent / 'data' / 'markets' / 'symbols.json'
with open(data_path) as f:
    market_data = json.load(f)
```

## Environment-Specific Data

Use environment variables to switch between datasets:
```bash
DATA_ENV=production  # Use production data
DATA_ENV=development # Use sample data
```

## Data Security

⚠️ **Important:**
- Never commit sensitive data or API responses containing user information
- Use `.gitignore` to exclude sensitive data files
- Sample data should be anonymized
- Production data should be stored in the database, not files

## Setup Script

Initialize data directory:
```bash
npm run setup:data
```

This will:
1. Create necessary subdirectories
2. Download required reference data
3. Seed database with initial data
