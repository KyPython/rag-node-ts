# Sample Datasets for RAG Testing

This directory contains sample datasets organized by domain to test the RAG (Retrieval-Augmented Generation) system across different use cases.

## Directory Structure

```
samples/
├── law-firms/          # Legal case files and precedents
├── compliance/         # Regulatory documents
├── real-estate/        # Property docs and contracts
└── dev-teams/          # Code documentation and API docs
```

## Usage

### Ingest All Datasets
```bash
# Ingest all files from a specific domain
npm run ingest -- samples/law-firms/*.md

# Ingest all datasets
npm run ingest -- samples/**/*.md
```

### Ingest Specific Domain
```bash
# Law firms
npm run ingest -- samples/law-firms/*.md

# Compliance
npm run ingest -- samples/compliance/*.md

# Real estate
npm run ingest -- samples/real-estate/*.md

# Dev teams
npm run ingest -- samples/dev-teams/*.md
```

## Dataset Descriptions

### Law Firms (`law-firms/`)
Legal documents including:
- Case summaries and court filings
- Legal precedents and court rulings
- Contract disputes and resolutions
- Employment law cases

**Sample Queries:**
- "What are the key precedents for confidentiality agreements?"
- "Summarize the ACME Corp v. Widget Industries case"
- "What factors determine force majeure in contract disputes?"

### Compliance (`compliance/`)
Regulatory and compliance documentation:
- GDPR data protection requirements
- SOX internal controls
- Industry-specific regulations
- Compliance best practices

**Sample Queries:**
- "What are the key GDPR data subject rights?"
- "What are the requirements for SOX internal controls?"
- "How should data breaches be reported under GDPR?"

### Real Estate (`real-estate/`)
Property and real estate documents:
- Purchase agreement templates
- Lease agreement requirements
- Property contracts and terms
- Commercial lease standards

**Sample Queries:**
- "What are the essential terms in a purchase agreement?"
- "What are the tenant's responsibilities in a commercial lease?"
- "What contingencies should be included in a real estate purchase?"

### Dev Teams (`dev-teams/`)
Technical documentation:
- API documentation standards
- Code review guidelines
- Development best practices
- Technical specifications

**Sample Queries:**
- "What are the best practices for API documentation?"
- "What should reviewers look for in code reviews?"
- "How should authentication be documented in APIs?"

## Testing Queries by Domain

After ingesting a dataset, test with domain-specific queries:

### Law Firms
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the key legal precedents for confidentiality agreements?", "topK": 3}'
```

### Compliance
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the GDPR data subject rights?", "topK": 3}'
```

### Real Estate
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What contingencies should be in a purchase agreement?", "topK": 3}'
```

### Dev Teams
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What are best practices for API documentation?", "topK": 3}'
```

## Adding New Documents

To add new documents to any dataset:
1. Create a new `.md` file in the appropriate directory
2. Use clear headings and structured content
3. Include relevant keywords and concepts
4. Follow the existing format for consistency
5. Ingest using: `npm run ingest -- path/to/new-file.md`

## Notes

- All documents are in Markdown format for easy editing
- Documents are structured to test semantic search capabilities
- Each domain has distinct terminology and concepts
- Documents can be mixed and matched for testing cross-domain queries

