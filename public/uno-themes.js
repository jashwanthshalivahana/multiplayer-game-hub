/**
 * UNO card visual themes — single source of truth for lobby + in-game styling.
 */
(function (global) {
  const CARD_THEMES = [
    {
      id: "classic",
      className: "",
      icon: "🎴",
      name: "Classic",
      desc: "Original UNO colors",
      deckLabel: "UNO",
      deckStyle: "linear-gradient(135deg,#1a1a3a,#2d1a4a)",
      miniBack: "linear-gradient(135deg,#c41e3a 0%,#1a1a3a 50%,#1a1a3a 100%)",
      felt: "radial-gradient(ellipse at center,#0d2a1a 0%,#051208 60%,#020805 100%)",
    },
    {
      id: "neon",
      className: "theme-neon",
      icon: "💡",
      name: "Neon",
      desc: "Glowing cyberpunk",
      deckLabel: "NEON",
      deckStyle: "linear-gradient(135deg,#0a0a20,#ff2d6b)",
      miniBack: "linear-gradient(135deg,#ff0055,#0040ff)",
      felt: "radial-gradient(ellipse at center,#0a1020 0%,#050510 70%)",
    },
    {
      id: "hp",
      className: "theme-hp",
      icon: "⚡",
      name: "Harry Potter",
      desc: "House colors & magic",
      deckLabel: "⚡",
      deckStyle: "radial-gradient(ellipse,#1a0a2e,#0d050f)",
      miniBack: "linear-gradient(135deg,#740001,#d3a625)",
      felt: "radial-gradient(ellipse at center,#1a1208 0%,#0a0804 70%)",
    },
    {
      id: "mercy",
      className: "theme-mercy",
      icon: "💀",
      name: "No Mercy",
      desc: "Brutal dark style",
      deckLabel: "💀",
      deckStyle: "linear-gradient(180deg,#222,#000)",
      miniBack: "repeating-linear-gradient(45deg,#111,#111 4px,#cc0000 4px,#cc0000 8px)",
      felt: "radial-gradient(ellipse at center,#1a0808 0%,#0a0202 70%)",
    },
    {
      id: "galaxy",
      className: "theme-galaxy",
      icon: "🌌",
      name: "Galaxy",
      desc: "Deep space vibes",
      deckLabel: "✦",
      deckStyle: "radial-gradient(ellipse,#1a0033,#000015)",
      miniBack: "linear-gradient(135deg,#7b0067,#4488ff)",
      felt: "radial-gradient(ellipse at center,#12082a 0%,#050210 70%)",
    },
    {
      id: "retro",
      className: "theme-retro",
      icon: "🕹️",
      name: "Retro",
      desc: "80s arcade pop",
      deckLabel: "8BIT",
      deckStyle: "linear-gradient(180deg,#ff6ec7,#7873f5)",
      miniBack: "linear-gradient(90deg,#ff6ec7,#7873f5,#42e695)",
      felt: "radial-gradient(ellipse at center,#2a1040 0%,#100820 70%)",
    },
  ];

  function getTheme(id) {
    return CARD_THEMES.find((t) => t.id === id) || CARD_THEMES[0];
  }

  function getThemeByClass(className) {
    return CARD_THEMES.find((t) => t.className === className) || CARD_THEMES[0];
  }

  global.UNO_THEMES = { CARD_THEMES, getTheme, getThemeByClass };
})(typeof window !== "undefined" ? window : global);
