# Deploying the documentation portal

The docs are a separate container from the application: a static export served by
nginx, ~86 MB, no Node process, no database, no secrets. A correction to the manual
does not rebuild or restart the signing app.

## Komodo resources

Both created on 2026-08-09, modelled on `workhub-platform-portal`, which builds a
second image out of one repository the same way.

| | Value |
|---|---|
| **Build** | `hubsign-docs` — id `6a78e9cab9e386e97cb69690` |
| repo / branch | `jesseframework/hubsign_by_documenso` / `new-design` |
| build path | `.` (repository root) |
| dockerfile | `apps/documentation/Dockerfile` |
| registry | `172.16.15.51:5000/futureedge/hubsign-docs` |
| **Stack** | `hubsign-docs` — id `6a78e9dbb9e386e97cb696aa` |
| server | us-flint-2 (`172.16.15.52`) |
| published port | `3010` → container `80` |
| replicas | 2, `start-first` rolling updates |

The stack's compose lives inline in Komodo. Its reviewable source is
`docker/production/docs.compose.yml` — **change both together.**

## First deploy

1. **Build** `hubsign-docs` in Komodo. The Dockerfile runs `next build` with
   `DOCS_STATIC_EXPORT=1` and copies the result into nginx.
2. **Deploy** the `hubsign-docs` stack.
3. Check `http://172.16.15.52:3010/` returns the landing page.

## GitHub webhook (optional, for automatic builds)

Webhook listener paths are per-resource, so the repository's existing webhook for
the `hubsign` build does not cover this one. To build the docs automatically on
push, add a second webhook in the repository settings:

```
Payload URL   https://app.hostzones.net/listener/github/build/hubsign-docs
Content type  application/json
Secret        same secret as the existing hubsign webhook
Events        Just the push event
```

Verified those listener paths exist (they answer 401 to an unsigned payload rather
than 404). Leave it off if you would rather build the docs deliberately — nothing
else depends on them being current.

## Reverse proxy

Point `docs.hubsign.io` at `172.16.15.52:3010` and terminate TLS there, as for
`hubsign.io`. nginx inside the container serves plain HTTP on 80.

## Notes

- **Clean URLs depend on `try_files $uri $uri.html`.** The static export writes
  `organization.html`, not `organization/index.html`; without that step every page
  in the site 404s.
- **The search index is cached for 5 minutes, not a year.** It is the one build
  artefact Nextra does not content-hash, so a long cache leaves visitors searching
  an index that no longer matches the pages. Keep that path short in any proxy cache
  too.
- The stack has **no placement constraint**, unlike `hubsign-landing`. The container
  is stateless with no volumes, so Swarm may schedule the replicas anywhere and the
  site survives a node going down.
