# Privacy behavior

This document describes the code in this repository. A real deployment must publish terms that match its actual Cloudflare, AWS, analytics, logging, and domain configuration.

## What this code stores

The current code has:

- no user accounts
- no cookies
- no analytics SDK
- no application database
- no persistent chat-history storage

The browser keeps recent messages in memory for the current tab. Refreshing or closing the page clears that in-browser conversation.

## What is processed

When AI mode is enabled, the browser sends recent messages to the Cloudflare Worker. The Worker sends a bounded recent-message window to Amazon Bedrock to generate a reply. Cloudflare and AWS may process message contents and request metadata under their applicable service terms and account settings.

The Worker deliberately avoids logging prompt bodies or provider response bodies. It logs only a structured error name and request path when an unexpected request failure occurs. Platform-generated invocation logs and network metadata may still exist.

## Operator obligations

Anyone deploying this project should:

- disclose the actual providers and retention settings
- avoid adding prompt logging by default
- minimize access to operational logs
- establish deletion, incident-response, and legal-request procedures
- assess applicable health, consumer-protection, privacy, and child-safety law
- avoid representing this prototype as confidential clinical care

Users should avoid entering information they would not want processed by the deployment's infrastructure providers.
