# Privacy policy

Easy Markdown Review runs in your browser inside Azure DevOps. It does not
operate its own servers. Its only outbound traffic outside Azure DevOps is the
optional usage and error data described below.

## Data access

The extension uses Azure DevOps permissions to:

- Read repositories, pull requests, Markdown files, work items, and identities.
- Create and update pull-request comment threads.

Data access occurs between your browser and Azure DevOps using your existing
session.

## Usage and error data

Official Marketplace releases send pseudonymous usage and error data so the
extension can be improved and its failures fixed:

- **Usage events** go to Microsoft Azure Application Insights. Each is a fixed
  event name (for example "comment created" or "file opened") with counters
  such as a comment's length or a load time.
- **Error reports** go to Application Insights and to Sentry. They contain the
  error type, a message and a stack trace. Web addresses, file paths and email
  addresses are removed from them first.
- **Identifiers**: Azure DevOps project and repository IDs (not names), a
  hashed pull-request number, a random ID for each page load, and a random ID
  for your browser stored in the extension's browser storage. None of these is
  linked to your account.
- **Environment**: the extension version and the language it is shown in.
  Application Insights records an approximate location (country, region,
  city) from the connection and discards the IP address; error reports ask
  Sentry not to store it either.

The extension never sends document or file contents, file or repository
names, comment text, search text, user names, email addresses, or access
tokens.

**Turning it off.** Click the pulse icon next to the bug icon in the
reader's status bar ("Send usage data"); it is struck through while off. The
setting applies to this browser. When it is off the extension sends nothing,
discards anything not yet sent, and deletes its random browser ID.

Usage events not yet sent are kept briefly in the browser's session storage, so
they can still be delivered if the page reloads; that copy is deleted when it is
sent, when the tab closes, or when you turn sending off.

Application Insights keeps data for 90 days. Sentry keeps error reports for 30
days on its free plan. Builds that you create yourself send nothing unless you
configure your own keys.

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

## Third-party services

Azure DevOps, Visual Studio Marketplace and Azure Application Insights data is
handled by Microsoft under its privacy statement. Error reports sent to Sentry
are handled by Functional Software, Inc. under the Sentry privacy policy.

## Contact

For questions, open a GitHub issue or email shubd3@gmail.com.
