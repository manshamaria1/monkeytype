import type { LanguageData } from "./types";

const words = `der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei hatte kann gegen vom können schon wenn habe seine ihre dann unter wir soll ich eines jahr zwei jahre diese dieser wieder keine uhr seiner worden will zwischen immer was sagte gibt alle diesen seit muss doch jetzt drei neue damit bereits da ab ohne sondern selbst ersten nun etwa heute weil ihr ihren sehr ihrer wo neuen machen gehen sehen kommen geben stehen finden bleiben liegen heißen denken nehmen tun dürfen glauben halten nennen zeigen führen sprechen bringen leben fahren meinen fragen kennen gelten stellen spielen arbeiten brauchen folgen lernen bestehen verstehen setzen bekommen beginnen erzählen versuchen schreiben laufen erklären entsprechen sitzen ziehen scheinen fallen gehören entstehen erhalten treffen suchen legen vorstellen handeln erreichen tragen schaffen lesen verlieren darstellen erkennen entwickeln reden aussehen erscheinen bilden anfangen erwarten wohnen betreffen warten vergehen helfen gewinnen schließen fühlen bieten interessieren erinnern ergeben anbieten studieren verbinden ansehen fehlen bedeuten vergleichen haus zeit tag welt mann frau kind leben hand auge stadt land wasser weg arbeit schule buch tisch tür fenster baum blume hund katze vogel brot milch kaffee rot blau grün weiß schwarz groß klein neu alt gut schlecht lang kurz hoch tief schnell langsam glücklich leicht schwer`.split(/\s+/);

export const german: LanguageData = {
  id: "german",
  name: "German",
  nativeName: "Deutsch",
  dir: "ltr",
  status: "full",
  hasCase: true,
  words: [...new Set(words)],
  punctuation: { comma: ",", period: ".", question: "?", exclamation: "!", extra: [";", ":"], quotes: ["„", "“"] },
  quotes: [
    { id: "de-1", text: "Es irrt der Mensch, solang er strebt.", source: "Johann Wolfgang von Goethe, Faust I (1808)" },
    { id: "de-2", text: "Übung macht den Meister.", source: "Sprichwort" },
    { id: "de-3", text: "Wer nicht wagt, der nicht gewinnt.", source: "Sprichwort" },
    { id: "de-4", text: "Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.", source: "Franz Kafka, Die Verwandlung (1915)" },
    { id: "de-5", text: "Aller Anfang ist schwer, aber jeder Tag mit etwas Übung macht das Tippen leichter.", source: "Monkeytype" },
  ],
};
