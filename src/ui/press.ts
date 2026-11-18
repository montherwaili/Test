/**
 * Run `action` the moment a finger touches the button.
 *
 * Phone browsers only turn a touch into a "click" when it is the only finger
 * on the screen. A driver holds the clutch with one thumb while pressing a
 * button with the other, so buttons must react to the touch itself. Mouse
 * and keyboard (Enter / Space on a focused button) still work through click.
 */
export function onPress(button: HTMLElement, action: () => void): void {
  let handledTouch = false;
  button.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      handledTouch = false;
      return;
    }
    handledTouch = true;
    // Stop the browser from also making a click (or a long-press menu) out of it.
    e.preventDefault();
    action();
  });
  button.addEventListener('click', () => {
    if (handledTouch) {
      handledTouch = false;
      return;
    }
    action();
  });
}
