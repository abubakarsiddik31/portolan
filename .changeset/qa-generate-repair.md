---
"@abubakarsiddiik/qa": patch
"@abubakarsiddiik/portolan": patch
---

Add qa_generate and qa_repair, completing the QA package's M2 surface:
generate turns a loose spec or a recorded trace into a draft case (goto steps
from route changes, semantic steps from located acts, secret-looking fill
values become env references), and repair recovers a moved or renamed target
from a failed run by name similarity, rewrites the case as a draft, records a
selector drift event, and confirms with one run. Both write through the same
draft path as qa_case_write; only qa_verify promotes.
