---
"@abubakarsiddiik/protocol": minor
"@abubakarsiddiik/sources": minor
"@abubakarsiddiik/compiler": minor
"@abubakarsiddiik/server": minor
"@abubakarsiddiik/portolan": minor
---

Ops keep their context. A recorded or discovered op used to be "click Save" with no sign of which page, which panel or which record, so an agent could not tell two `delete` buttons apart or know what a call would change. An op now has an optional `context` (the goal it was recorded for, the page, the named panel, the row it acts on, and what happened when it ran: the API calls and the messages shown). Discovery reads it from the page's structure, and the same label in two panels is now two capabilities instead of one. The compiler keeps the run's story, and a summary that would say only "Recorded: click Save." becomes the goal. `open_site` and the tool descriptions show it, and `map lint` warns about a bare parameterless `ui` op. Also fixes an `http` op compiled from a recording dropping its `auth`.
