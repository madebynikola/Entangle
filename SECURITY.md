# Security

Please do not report a security problem in a public issue. Use
[Report a vulnerability](https://github.com/madebynikola/Entangle/security/advisories/new) on GitHub instead.
Say what is affected and how to reproduce it. We answer within a week.

Entangle is a research prototype. Its local server has no authentication, and its API starts processes and writes files.
It listens on 127.0.0.1 only. Do not set `HOST=0.0.0.0` on a network you do not trust. Model API keys stay in your own `.env` file and are never sent anywhere except the model provider.
