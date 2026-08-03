# Stabilize bounded CSS edit

The trusted wrapper will append one enum-only plan to this prompt. The plan contains no raw feedback. Implement it only when `outcome` is `proposed_change`.

You may modify exactly the existing file named by `targetFile` and no other file. Make one small CSS-only improvement matching `theme` and `changeKind`, with no more than 120 added plus deleted lines. Do not add, delete, rename, stage, or generate files.

Do not run commands, Git, package managers, tests, network tools, or deployment tools. Do not modify content, HTML, JavaScript, prompts, safety behavior, crisis or medication behavior, privacy, consent, feedback, authentication, memory, billing, legal text, configuration, dependencies, scripts, tests, or deployment.

Do not add external resources, imports, URLs, generated content, hiding rules, overlays, fixed or absolute positioning, zero opacity or dimensions, disabled pointer events, animation, transforms, `!important`, or secret-like strings. If the plan cannot be implemented safely within those limits, make no edit and return `unable`.

Return only the JSON required by `edit.schema.json`.
