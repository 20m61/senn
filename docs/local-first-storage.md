# Local-first Storage

## Principle

SENN does not store user communication data on application servers.
Local persistence is optional and user-controlled.

## Default Behavior

By default, SENN does not persist:

- Chat messages
- Voice
- Temporary reactions
- Typing state
- Presence state
- Room state

## User-selected Persistence

Users may choose to persist:

- Profile cards
- Received files
- Whiteboards
- Shared notes
- Avatar settings
- Add-on state
- Contact cards
- Explicitly saved conversations

## Storage Backends

### IndexedDB

Used for:

- Metadata
- Settings
- Event logs
- Small structured data

### OPFS

Used for:

- Files
- Images
- Large blobs
- Add-on assets

### Cache API

Used for:

- Static app shell
- Static add-on assets

## P2P Sync

Stored data can be shared with peers only after explicit user action or add-on permission.

P2P sync should:

1. Exchange metadata.
2. Compare IDs or hashes.
3. Send only missing data.
4. Validate received data.
5. Ask for user approval when needed.

## Deletion

Users can delete local data.
SENN cannot guarantee deletion from peers after data has been shared.
