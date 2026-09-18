# Rasuko

Rasuko is a desktop workspace for creating flexible pages from reusable views. It is built with Electron, Svelte, and TypeScript.

## Requirements

- Node.js 22.19 or newer
- npm

## Development

```bash
git clone https://github.com/TheAnimatrix/Rasuko.git
cd Rasuko
npm ci
npm run dev
```

## Build

Create a production build:

```bash
npm run build
```

Create a Windows installer:

```bash
npm run dist:win
```

Build output is written to `out/`, and packaged releases are written to `release/`.

## Checks

Before opening a pull request, run:

```bash
npm run typecheck
npm test
```

## Contributing

Contributions are welcome through pull requests.

1. Fork the repository.
2. Create a focused branch from `main`.
3. Make and test your changes.
4. Commit with a clear message.
5. Push your branch and open a pull request.

Please describe what changed, why it changed, and how you tested it. Keep pull requests focused so they are easier to review.

## License

Rasuko is released under the [MIT License](LICENSE).
