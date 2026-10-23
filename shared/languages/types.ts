export interface Quote {
  id: string;
  text: string;
  source: string;
}

export interface LanguageData {
  id: string;
  name: string;
  nativeName: string;
  dir: "ltr" | "rtl";
  /**
   * full: generation, rendering and typing covered by automated tests with a
   *       standard keyboard.
   * beta: covered by automated tests, but needs a native keyboard layout or IME
   *       and has had limited real-user testing.
   */
  status: "full" | "beta";
  /** Whether the script has upper/lower case (affects punctuation capitalisation). */
  hasCase: boolean;
  /** Words ordered roughly by frequency (most common first). No spaces inside words. */
  words: string[];
  punctuation: {
    comma: string;
    period: string;
    question: string;
    exclamation: string;
    extra: string[];
    quotes: [string, string];
    /** Spanish-style inverted opening marks. */
    invertedQuestion?: string;
    invertedExclamation?: string;
  };
  /** Language-specific digits are not used: tests use ASCII digits for numbers. */
  quotes: Quote[];
}
