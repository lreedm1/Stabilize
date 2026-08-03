# Security policy

## Reporting a software vulnerability

Please use GitHub's private security-advisory feature for vulnerabilities involving credential exposure, OAuth state or callback handling, account-memory isolation, cookie forgery, prompt or response disclosure, safety-route bypasses, injection, denial of service, or other exploitable behavior. Do not include real user conversations, credentials, Google tokens, or private health information in a public issue.

Public issues are appropriate for non-sensitive bugs and feature requests.

## Real-world emergencies

The vulnerability-reporting process is not an emergency or crisis service. If someone may be in immediate danger or experiencing a medical emergency, contact local emergency help or a staffed human service rather than waiting for a repository response.

## Supported version

Only the current default branch is maintained during the prototype stage.

## Anonymous-memory launch gate

Guest continuity gives each valid first-party browser cookie its own Durable
Object. Before enabling it for public traffic, verify Cloudflare edge controls
cover guest-cookie minting, `/api/chat`, and `/guest/memory/delete`, and set
alerts and spend limits for new guest objects and model calls. The Worker's
origin and cookie binding checks prevent browser CSRF and cross-session access;
they are not bot authentication because an automated client can supply its own
request headers and repeatedly clear cookies. Do not treat a green application
health check as proof that these account-level WAF or bot controls are active.
