# Table Diff Gallery

This document isolates the table changes that Easy Markdown Review must explain precisely.

Each section has an unchanged control row. If that row lights up, the diff is too broad.

## 1. Single cell edit

Only one value changes; the matching cell should show an inline red/green word diff.

| Setting | Value | Notes |
| --- | --- | --- |
| Theme | Light | Used for the reader surface. |
| Timeout | 30 seconds | Unchanged control row. |

The sentence after this table is an unchanged diff anchor.

## 2. Complete cell replacement

The old and new values share no words, but their column position is unambiguous.

| Signal | Cadence | Owner |
| --- | --- | --- |
| Active mitigation | When meaningful progress occurs | Incident commander |
| Stable monitoring | Every 60 minutes | Operations |

The sentence after this table is an unchanged diff anchor.

## 3. Multiple cells edited in one row

Several cells change in one row; each changed cell should remain independently readable.

| Service | Region | Tier | Owner |
| --- | --- | --- | --- |
| Checkout | West Europe | Standard | Platform |
| Search | East US | Standard | Discovery |

The sentence after this table is an unchanged diff anchor.

## 4. Added middle column

A new column is inserted between two stable columns; the new cells should be green.

| Signal | Owner |
| --- | --- |
| Customer impact | Response team |
| Active mitigation | Incident commander |
| Stable monitoring | Operations |

The sentence after this table is an unchanged diff anchor.

## 5. Removed middle column

A legacy column disappears between two stable columns; removed cells should appear struck red in place.

| Service | Legacy mode | Owner |
| --- | --- | --- |
| Checkout | Enabled | Platform |
| Search | Disabled | Discovery |
| Billing | Disabled | Finance systems |

The sentence after this table is an unchanged diff anchor.

## 6. Added row

One row is added; only the new row should receive the green added treatment.

| Code | Retry | Meaning |
| --- | --- | --- |
| 200 | No | Request succeeded. |
| 429 | Yes | Back off and retry. |
| 503 | Yes | Service unavailable. |

The sentence after this table is an unchanged diff anchor.

## 7. Removed row

One row is removed; the reader should show the old cells directly as a red structural row at their original position.

| Region | Status | Owner |
| --- | --- | --- |
| East US | Active | Core platform |
| Central US | Deprecated | Legacy operations |
| West Europe | Active | Core platform |
| North Europe | Active | Edge platform |

The sentence after this table is an unchanged diff anchor.

## 8. Ambiguous structural rewrite

This row changes shape and shares no stable cell value. Amber is the correct conservative fallback.

| Legacy field | Legacy value |
| --- | --- |
| Legacy policy | Weekly batch |
| Control | Unchanged |

The sentence after this table is an unchanged diff anchor.

## 9. Column header rename

Only the header label changes; body cells should remain neutral.

| Service | Response owner | SLA |
| --- | --- | --- |
| Checkout | Platform | 30 minutes |
| Search | Discovery | 60 minutes |

The sentence after this table is an unchanged diff anchor.

## 10. Swapped columns

Two columns exchange positions together with their values.

| Cadence | Owner |
| --- | --- |
| Every 30 minutes | Incident commander |
| Every 60 minutes | Operations |

The sentence after this table is an unchanged diff anchor.

## 11. Swapped rows

Two rows exchange positions; the old position should read removed and the new position added.

| Service | Owner |
| --- | --- |
| Checkout | Platform |
| Search | Discovery |
| Billing | Finance systems |

The sentence after this table is an unchanged diff anchor.

## 12. Appended column

A new final column is added after two stable columns.

| Service | Owner |
| --- | --- |
| Checkout | Platform |
| Search | Discovery |

The sentence after this table is an unchanged diff anchor.

## 13. Removed first column

The first column disappears while the remaining columns stay stable.

| Legacy ID | Service | Owner |
| --- | --- | --- |
| svc-01 | Checkout | Platform |
| svc-02 | Search | Discovery |

The sentence after this table is an unchanged diff anchor.

## 14. Filled and cleared cells

One empty cell gains a value while another existing value is removed.

| Service | Escalation |
| --- | --- |
| Checkout | |
| Search | Pager |
| Billing | Email |

The sentence after this table is an unchanged diff anchor.

## 15. Formatting-only cell edit

The rendered words stay the same while Markdown formatting changes; the affected cell should use a simple amber wash.

| Resource | Description |
| --- | --- |
| Runbook | incident guide |
| Dashboard | service health |

The sentence after this table is an unchanged diff anchor.

## 16. Whole table replacement

The old table is removed and a new table with a different schema is added.

| Legacy queue | Batch window |
| --- | --- |
| Orders | Nightly |
| Notifications | Hourly |

The replacement boundary remains unchanged.

The sentence after this table is an unchanged diff anchor.

## 17. Long wrapping cell

A dense prose cell changes near its middle while most of the surrounding explanation remains stable.

| Policy | Guidance | Owner |
| --- | --- | --- |
| Escalation | Notify the incident commander after the second failed mitigation attempt, include the latest customer-impact estimate, and record the decision in the response log before continuing. | Reliability |
| Recovery | Keep the rollback plan current and verify it during every quarterly exercise. | Platform |

The sentence after this table is an unchanged diff anchor.

## 18. Link label and destination

A linked cell changes both the reader-facing label and its URL while adjacent rich content remains stable.

| Resource | Link | Notes |
| --- | --- | --- |
| Incident guide | [Legacy response guide](https://example.com/docs/legacy-response) | Open during triage. |
| Dashboard | [Service health](https://example.com/health) | Unchanged control row. |

The sentence after this table is an unchanged diff anchor.

## 19. Inline code and emphasis

Rich inline formatting surrounds a small value edit.

| Setting | Required value | Explanation |
| --- | --- | --- |
| Retry mode | Set `retry.mode` to **legacy**. | Applies to transient failures only. |
| Timeout | Keep `request.timeout` at **30 seconds**. | Unchanged control row. |

The sentence after this table is an unchanged diff anchor.

## 20. Escaped pipe and symbols

The cell contains an escaped pipe, punctuation, and symbols that must not split the table structure.

| Expression | Meaning | Owner |
| --- | --- | --- |
| `state == "active" \| state == "queued"` | Includes active or queued work. | Operations |
| `severity <= 2` | Includes high-severity incidents. | Response team |

The sentence after this table is an unchanged diff anchor.

## 21. Wide rich table

Several long rich cells change in one row while a second row remains a stable visual control.

| Capability | Current behavior | Runbook | Query | Escalation |
| --- | --- | --- | --- | --- |
| Checkout recovery | **Manual** failover after two health checks fail and customer impact is confirmed. | [Recovery v1](https://example.com/runbooks/recovery-v1) | `Failures \| where Service == "Checkout"` | Notify Platform after **30 minutes**. |
| Search recovery | Automatic retry with bounded exponential backoff. | [Search recovery](https://example.com/runbooks/search) | `Failures \| where Service == "Search"` | Notify Discovery after **60 minutes**. |

The sentence after this table is an unchanged diff anchor.

## 22. Link destination only

The visible label stays the same while only the destination changes; a link metadata indicator should reveal the target diff.

| Resource | Link | Owner |
| --- | --- | --- |
| Escalation guide | [Open guide](https://example.com/docs/escalation-v1) | Reliability |
| Dashboard | [Service health](https://example.com/health) | Operations |

The sentence after this table is an unchanged diff anchor.

## 23. Link hostname change

The visible label stays stable while the link moves to a different host; the metadata callout should warn clearly.

| Resource | Link | Owner |
| --- | --- | --- |
| Support guide | [Open support](https://docs.contoso.test/support) | Reliability |
| Dashboard | [Service health](https://example.com/health) | Operations |

The sentence after this table is an unchanged diff anchor.

## 24. Repeated-value false anchor

Repeated values such as Yes cannot safely anchor an inserted column; this must use amber with a `Before` chip.

| Yes | Yes |
| --- | --- |
| Yes | Yes |
| Control | Stable |

The sentence after this table is an unchanged diff anchor.

## 25. Empty-cell false anchor

An empty value cannot prove structural correspondence; this must use amber with a `Before` chip.

| | |
| --- | --- |
| Schedule | |
| Control | Stable |

The sentence after this table is an unchanged diff anchor.

## 26. Partial schema replacement

One header stays stable while an old column is replaced by two different columns; mapping is ambiguous.

| Service | Legacy mode |
| --- | --- |
| Checkout | Enabled |
| Search | Disabled |

The sentence after this table is an unchanged diff anchor.

## 27. Renamed and added schema

A header rename combined with a new column has no exact anchor for the renamed field; this must use amber.

| Response owner | SLA |
| --- | --- |
| Platform | 30 minutes |
| Discovery | 60 minutes |

The sentence after this table is an unchanged diff anchor.

## 28. Formatting and link target together

Equal visible text changes both formatting and hidden destination; both signals must remain visible.

| Resource | Link |
| --- | --- |
| Guide | [Incident guide](https://example.com/v1) |

The sentence after this table is an unchanged diff anchor.

## 29. Text and image metadata together

Visible prose and image source change in the same cell; word marks and image metadata must coexist.

| Resource | Preview |
| --- | --- |
| Architecture | Legacy ![Architecture](https://example.com/v1.png) |

The sentence after this table is an unchanged diff anchor.

## 30. Link wrapping added

The visible label stays equal while a destination is introduced around it.

| Resource | Guidance |
| --- | --- |
| Incident | Incident guide |

The sentence after this table is an unchanged diff anchor.

## 31. One of multiple links changes

Only the changed target should get metadata; the stable sibling remains untouched.

| Links |
| --- |
| [Changed](https://example.com/v1) and [Stable](https://example.com/stable) |

The sentence after this table is an unchanged diff anchor.

## 32. One of multiple images changes

Image metadata must stay index-aligned when a sibling image is unchanged.

| Previews |
| --- |
| ![Changed](https://example.com/v1.png) ![Stable](https://example.com/stable.png) |

The sentence after this table is an unchanged diff anchor.

## End

The gallery ends with unchanged prose so the final table hunk stays isolated.
