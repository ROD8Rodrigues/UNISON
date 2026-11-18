# Legacy prototype

This folder preserves the original single-file TELAWORK backend for reference:

- `index.js` — Express + NeDB + Socket.IO prototype (superseded by `src/`).
- `friend_request.json` — a scratch request fixture from the prototype.

The legacy NeDB data remains in `server/data/`. To carry existing accounts
(bcrypt password hashes are compatible) into the SQLite database, run:

```bash
cd server
npm run import:legacy
```

Do not run the legacy server in production. It lacks input validation, refresh
token rotation, session revocation, upload scanning and the community features
implemented in the current server.
