import { useEffect, useRef } from 'react';
import styles from './CreditsDialog.module.css';

/*
 * Credits and licences, on request.
 *
 * Until Stage 9 all of this was permanently in the footer: two paragraphs naming three upstream
 * projects, their licences, what the generator does locally and what TryAPL does remotely. It was
 * the largest block of text in an application whose point is that you play it.
 *
 * **Moved, not removed, and the difference matters legally as well as editorially.** One of the
 * three sources is MIT, which requires the copyright notice and permission notice to travel with
 * the software — so it ships here, in the application, one click from every page. The other two
 * are public-domain dedications that ask for nothing; they are credited because it is owed in the
 * ordinary sense rather than because a licence compels it. Nothing that has to be shown has been
 * demoted to a repository file.
 *
 * A native `<dialog>` rather than a hand-built overlay: the browser gives the modal backdrop,
 * focus trapping, `Escape`, inertness of the page behind it and the right ARIA semantics, none of
 * which is worth reimplementing and all of which is easy to get subtly wrong.
 */

export interface CreditsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function CreditsDialog({ open, onClose }: CreditsDialogProps): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;

    /*
     * `showModal` rather than the `open` attribute.
     *
     * The attribute renders a dialog that is merely visible: no backdrop, no focus trap, no
     * `Escape`, and the page behind it still reachable by Tab. Everything this needs comes from
     * the method, so React's declarative `open` is deliberately not used.
     */
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="credits-title"
      /* Escape and the backdrop both close it, and both arrive here. */
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself rather than on anything inside it.
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className={styles.body}>
        <div className={styles.header}>
          <h2 className={styles.title} id="credits-title">
            Credits &amp; licences
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close credits">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <section className={styles.section}>
          <h3 className={styles.heading}>Drum machine samples</h3>
          <p>
            Selected samples from{' '}
            <a
              className={styles.link}
              href="https://github.com/smpldsnds/drum-machines"
              rel="noreferrer noopener"
              target="_blank"
            >
              smpldsnds/drum-machines
            </a>
            , a public-domain collection. Nine of its ten packs are included.
          </p>
          <p>
            The TR-909 is rendered from{' '}
            <a
              className={styles.link}
              href="https://github.com/andremichelle/tr-909"
              rel="noreferrer noopener"
              target="_blank"
            >
              andremichelle/tr-909
            </a>
            , © 2022 André Michelle, MIT licensed. The files here are the output of running that synthesis,
            not a pack of finished samples copied across.
          </p>
          {/*
            The MIT permission notice, in full and verbatim.

            This is the one piece of text on this page that is not editorial. MIT requires the
            copyright notice and this notice to be included in all copies or substantial portions
            of the software, and a browser application is a copy — so it ships in the application
            rather than only in `THIRD_PARTY_NOTICES.md`.
          */}
          <blockquote className={styles.licence}>
            Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
            associated documentation files (the “Software”), to deal in the Software without restriction,
            including without limitation the rights to use, copy, modify, merge, publish, distribute,
            sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
            furnished to do so, subject to the following conditions: The above copyright notice and this
            permission notice shall be included in all copies or substantial portions of the Software. THE
            SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
            LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
            NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
            DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
            OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
          </blockquote>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>Tone sounds</h3>
          <p>
            Roland Jupiter-4 samples from{' '}
            <a
              className={styles.link}
              href="https://github.com/publicsamples/Roland-Jupiter-4"
              rel="noreferrer noopener"
              target="_blank"
            >
              publicsamples/Roland-Jupiter-4
            </a>
            , released into the public domain. Six presets at seven pitches each, converted to mono, reduced
            to 16-bit and trimmed; nothing is equalised, retuned or looped.
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>Dyalog APL</h3>
          <p>
            The APL tools run expressions on{' '}
            <a className={styles.link} href="https://tryapl.org" rel="noreferrer noopener" target="_blank">
              TryAPL
            </a>
            , a public service of Dyalog Ltd, one whole pattern or phrase at a time and only when you ask. The
            instant generator and all timing are local to your browser.
          </p>
        </section>

        <p className={styles.disclaimer}>
          APL Beats is an independent personal project. It is not a Dyalog product, and it is not affiliated
          with or endorsed by the manufacturers of the instruments named here.
        </p>

        <p className={styles.more}>
          Full provenance — every file, its checksum and what was done to it — is in{' '}
          <a
            className={styles.link}
            href="https://github.com/dragnim/aplbeats/blob/main/THIRD_PARTY_NOTICES.md"
            rel="noreferrer noopener"
            target="_blank"
          >
            THIRD_PARTY_NOTICES.md
          </a>
          .
        </p>
      </div>
    </dialog>
  );
}
