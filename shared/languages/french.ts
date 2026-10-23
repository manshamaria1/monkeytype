import type { LanguageData } from "./types";

const words = `le de un être et à il avoir ne je son que se qui ce dans en du elle au pour pas que vous par sur faire plus dire me on mon lui nous comme mais pouvoir avec tout y aller voir en bien où sans tu ou leur homme si deux mari moi vouloir te femme venir quand grand celui si notre devoir là jour prendre même votre tout rien petit encore aussi quelque dont tout mer trouver donner temps ça peu même falloir sous parler alors main chose ton mettre vie savoir yeux passer autre après regarder toujours puis jamais cela aimer non heure croire cent monde donc enfant fois seul autre entre vers chez demander jeune jusque très moment rester répondre tout tête père fille mille premier car entendre ni bon trois cœur ainsi an quatre un terre contre dieu monsieur voix penser quel arriver maison devant coup beau connaître devenir air mot nuit sentir vers vouloir sembler mourir perdre pendant porte reprendre paraître chercher sortir mort ouvrir lieu jeter rendre parce partir comprendre amour pied place nom âme jour mois soir matin ville rue école livre table eau feu ciel soleil lune arbre fleur chien chat oiseau pain lait café rouge bleu vert blanc noir petit nouveau vieux bon mauvais long court haut bas heureux triste facile difficile rapide lent toujours jamais aujourd'hui demain hier maintenant ici loin près mieux écrire lire jouer travailler manger boire dormir marcher courir chanter danser apprendre`.split(/\s+/);

export const french: LanguageData = {
  id: "french",
  name: "French",
  nativeName: "Français",
  dir: "ltr",
  status: "full",
  hasCase: true,
  words: [...new Set(words)],
  punctuation: { comma: ",", period: ".", question: "?", exclamation: "!", extra: [";", ":"], quotes: ["«", "»"] },
  quotes: [
    { id: "fr-1", text: "Je pense, donc je suis.", source: "René Descartes, Discours de la méthode (1637)" },
    { id: "fr-2", text: "On ne voit bien qu'avec le cœur. L'essentiel est invisible pour les yeux.", source: "Antoine de Saint-Exupéry, Le Petit Prince (1943)" },
    { id: "fr-3", text: "Petit à petit, l'oiseau fait son nid.", source: "Proverbe" },
    { id: "fr-4", text: "Il faut cultiver notre jardin.", source: "Voltaire, Candide (1759)" },
    { id: "fr-5", text: "Rien ne sert de courir; il faut partir à point.", source: "Jean de La Fontaine, Le Lièvre et la Tortue (1668)" },
  ],
};
