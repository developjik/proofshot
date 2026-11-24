# Interaction scenes

Scenes add stateful captures after the ordinary route table. Existing route-only
configuration, image names, report fields and output remain unchanged when scenes
are absent. The same scene steps run on both base and head, in a fresh browser
context per scene and viewport. Scene names must be unique.

```json
{
  "routes": ["/"],
  "scenes": [
    {
      "name": "modal",
      "route": "/",
      "steps": [
        { "action": "click", "selector": "#open-details" },
        { "action": "wait", "selector": "[role=dialog]" }
      ],
      "expect": "[role=dialog]"
    },
    {
      "name": "error",
      "route": "/",
      "steps": [
        { "action": "fill", "selector": "input[name=email]", "value": "invalid" },
        { "action": "press", "selector": "input[name=email]", "value": "Enter" }
      ],
      "expect": "[role=alert]"
    },
    {
      "name": "empty",
      "route": "/",
      "steps": [{ "action": "click", "text": "Clear filters" }],
      "expect": "[data-state=empty]"
    }
  ]
}
```

Save this as `.proofshot.json`, adapting selectors to your application. The sample
is also in `docs/scenes.example.json`. `text` means exact visible text and is an
alternative to `selector`, not an extra filter. Click/fill/press require one target;
wait waits for a visible target. Fill and press require `value`. Steps accept
`timeoutMs` from 1 to 30000 (default 5000), at most 100 steps per scene. The action
sequence has a total 30-second budget. `expect` is a CSS selector that must be
visible within 5 seconds. No arbitrary JavaScript is executed by configuration.

Only scenes whose resolved route is in the selected capture routes run. Route
params apply to scene routes too. `proofshot routes --json` includes matching scenes
and the text command lists their names. Use `routes` in config or `--routes` to
select a scene route explicitly if it is not inferred from changed files.

A failed step or missing expected element marks only that scene as `blocked`
(`status: error` in JSON for compatibility). Other scenes and ordinary routes still
run. `--fail-on error` fails the command after reports are written. Screenshot,
pixel difference, lightweight a11y and optional axe deltas belong to each scene.
A scene with a failed side keeps available evidence from the other side. Scene
artifacts use a separate hashed namespace, so names cannot overwrite route images.

Use non-production test data and a disposable app environment. Steps are real UI
actions and can submit forms or trigger your app's side effects. Do not put secrets
in scene values or commit authenticated sessions. Browser contexts start without
saved credentials. The generated workflow uploads evidence with `if: always()`;
it does not swallow compare failure as a reason to skip the artifact.

After actions, lazy content is swept with bounded instant scrolling. The post-action
scroll position is restored before both full-page and viewport-only screenshots;
fixed/sticky and scroll-driven UI therefore reflects that state, not a forced top.
A 3-second sweep capped at 100000px does not guarantee infinite-scroll content.
