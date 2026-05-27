# Accessibility

Elephant Ears uses an icon-first UI, so accessible names are mandatory.

Current baseline:

- Primary nav buttons have `aria-label` and `aria-current`.
- Icon buttons use visible tooltips/title plus `aria-label`.
- Player is wrapped in a footer with `aria-label="Player"`.
- Modal clip composer uses `role="dialog"` and `aria-modal`.
- Status messages use `role="status"`.
- Visible focus rings are high contrast yellow.
- Controls use real buttons/select/input elements.

Required future audit:

- Test with VoiceOver on iOS/macOS.
- Test with TalkBack on Android.
- Test keyboard-only queue reordering.
- Add reduced-motion preference for animated transitions.
- Ensure color-coded badges have text equivalents.
- Add transcript support as an accessibility feature, not only a search feature.
