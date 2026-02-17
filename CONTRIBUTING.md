# Contributing to Claude Learner

First off, thanks for taking the time to contribute! 🎉

## How Can I Contribute?

### Reporting Bugs

- Check if the bug has already been reported in [Issues](https://github.com/unisone/claude-learner/issues)
- If not, create a new issue with:
  - Clear title and description
  - Steps to reproduce
  - Expected vs actual behavior
  - Your environment (OS, Node version)

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case and expected behavior
- Bonus: Include a rough implementation idea

### Pull Requests

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with a clear message (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/claude-learner.git
cd claude-learner

# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js analyze
```

## Code Style

- TypeScript with strict mode
- 2-space indentation
- Single quotes for strings
- Meaningful variable names

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `refactor:` Code change that neither fixes a bug nor adds a feature
- `test:` Adding tests
- `chore:` Maintenance

## Questions?

Feel free to open an [issue](https://github.com/unisone/claude-learner/issues) or start a [discussion](https://github.com/unisone/claude-learner/discussions).
