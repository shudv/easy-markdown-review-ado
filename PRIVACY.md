# Privacy policy

Easy Markdown Review runs in your browser inside Azure DevOps. It does not
operate its own servers.

## Data access

The extension uses Azure DevOps permissions to:

- Read repositories, pull requests, Markdown files, work items, and identities.
- Create and update pull-request comment threads.

Data access occurs between your browser and Azure DevOps using your existing
session.

## Telemetry

Official Marketplace releases do not collect or send telemetry. Builds that you
create yourself, or forks that you configure, may enable optional telemetry.

## Browser storage

The extension stores comment drafts, reader preferences, recent locations,
navigation state, and temporary caches in browser storage. This data stays on
your device. You can remove it by clearing your browser data.

## External content

Images or links in Markdown files can point to external sites. Your browser
contacts those sites directly when it loads those images or opens those links.

Comment threads started in the extension end with a small "Markdown Review" badge
linking back to the comment. The badge image is served by shields.io: when Azure
DevOps shows the comment, your browser loads it from `img.shields.io`, which sees
your IP address and `https://dev.azure.com/` as the referrer, not the
organization, project, pull request, or comment.

## Microsoft services

Azure DevOps and Visual Studio Marketplace data is handled by Microsoft under
its privacy statement.

## Contact

For questions, open a GitHub issue or email shubd3@gmail.com.
