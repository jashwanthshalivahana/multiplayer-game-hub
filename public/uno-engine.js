(function (global) {
  const COLORS = ["red", "blue", "green", "yellow"];
  const VALUES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2"];
  const WILDS = ["wild", "wild4"];

  class UnoEngine {
    constructor() {
      this.reset();
    }

    reset() {
      this.players = [];
      this.hands = {};
      this.deck = [];
      this.discardPile = [];
      this.activeColor = null;
      this.currentTurn = 0;
      this.direction = 1;
      this.drawStack = 0;
      this.unoCalled = {};
      this.pendingAction = null; // null, 'chooseColor', 'challengeWild4', 'chooseSwap'
      this.actionData = null;
      this.lastWild4Player = null; 
      this.winner = null;
      this.scores = {};
      this.logs = [];
    }

    addPlayer(id) {
      this.players.push(id);
      this.hands[id] = [];
      this.unoCalled[id] = false;
    }

    log(msg) {
      this.logs.push(msg);
      if (this.logs.length > 50) this.logs.shift();
    }

    startGame() {
      this.buildDeck();
      this.shuffleDeck();
      
      for (const pid of this.players) {
        this.hands[pid] = this.drawCards(7);
      }

      // Initial card cannot be wild4
      let top;
      do {
        top = this.deck.pop();
        if (top.value === "wild4") {
          this.deck.unshift(top); // put it back at bottom
          top = null;
        }
      } while (!top);

      this.discardPile.push(top);
      this.activeColor = top.color !== "wild" ? top.color : COLORS[Math.floor(Math.random() * 4)];
      
      this.currentTurn = 0;
      this.direction = 1;
      this.drawStack = 0;
      this.pendingAction = null;
      this.winner = null;

      this.applyCardEffect(top, null, true); // apply initial card effect
      this.log("Game started.");
    }

    buildDeck() {
      this.deck = [];
      let idCounter = 0;
      for (const color of COLORS) {
        this.deck.push({ id: `c${idCounter++}`, color, value: "0" });
        for (let i = 1; i <= 9; i++) {
          this.deck.push({ id: `c${idCounter++}`, color, value: i.toString() });
          this.deck.push({ id: `c${idCounter++}`, color, value: i.toString() });
        }
        for (const action of ["skip", "reverse", "draw2"]) {
          this.deck.push({ id: `c${idCounter++}`, color, value: action });
          this.deck.push({ id: `c${idCounter++}`, color, value: action });
        }
      }
      for (let i = 0; i < 4; i++) {
        this.deck.push({ id: `c${idCounter++}`, color: "wild", value: "wild" });
        this.deck.push({ id: `c${idCounter++}`, color: "wild", value: "wild4" });
      }
    }

    shuffleDeck() {
      for (let i = this.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
      }
    }

    drawCards(count) {
      const drawn = [];
      for (let i = 0; i < count; i++) {
        if (this.deck.length === 0) {
          if (this.discardPile.length <= 1) break; // no cards left at all
          const top = this.discardPile.pop();
          this.deck = this.discardPile;
          this.discardPile = [top];
          this.shuffleDeck();
          this.deck.forEach(c => { if(c.color === "wild") c.chosenColor = null; });
        }
        if (this.deck.length > 0) drawn.push(this.deck.pop());
      }
      return drawn;
    }

    getTopCard() {
      return this.discardPile[this.discardPile.length - 1];
    }

    canPlayCard(card) {
      if (this.pendingAction) return false;
      
      const top = this.getTopCard();
      
      if (this.drawStack > 0) {
        if (top.value === "draw2" && card.value === "draw2") return true;
        if (top.value === "wild4" && card.value === "wild4") return true;
        return false;
      }

      if (card.color === "wild") return true;
      if (card.color === this.activeColor) return true;
      if (card.value === top.value) return true;
      return false;
    }

    playCard(playerId, cardId) {
      if (this.winner) return false;
      if (this.players[this.currentTurn] !== playerId) return false;
      if (this.pendingAction) return false;

      const hand = this.hands[playerId];
      const cardIdx = hand.findIndex(c => c.id === cardId);
      if (cardIdx === -1) return false;

      const card = hand[cardIdx];
      if (!this.canPlayCard(card)) return false;

      // Play the card
      hand.splice(cardIdx, 1);
      this.discardPile.push(card);
      
      // Reset UNO status if player has more than 1 card (they played safely)
      if (hand.length !== 1) this.unoCalled[playerId] = false;

      this.log(`Player ${playerId} played ${card.color} ${card.value}`);

      if (card.color !== "wild") {
        this.activeColor = card.color;
      }

      this.applyCardEffect(card, playerId, false);
      this.checkWin(playerId);

      if (!this.pendingAction && !this.winner) {
        this.nextTurn();
      }
      return true;
    }

    applyCardEffect(card, playerId, isInitial = false) {
      if (card.value === "skip") {
        this.nextTurn(true);
      } else if (card.value === "reverse") {
        this.direction *= -1;
        if (this.players.length === 2 && !isInitial) {
          this.nextTurn(true); // acts like skip in 2-player
        }
      } else if (card.value === "draw2") {
        this.drawStack += 2;
      } else if (card.value === "wild4") {
        this.drawStack += 4;
        if (!isInitial) {
          this.pendingAction = "chooseColor";
          this.lastWild4Player = playerId;
        }
      } else if (card.value === "wild") {
        if (!isInitial) this.pendingAction = "chooseColor";
      } else if (card.value === "0" && !isInitial) {
        // 0 rotates hands
        const handsCopy = {};
        for (let i = 0; i < this.players.length; i++) {
          const giver = this.players[i];
          let receiverIdx = (i + this.direction) % this.players.length;
          if (receiverIdx < 0) receiverIdx += this.players.length;
          handsCopy[this.players[receiverIdx]] = this.hands[giver];
        }
        this.hands = handsCopy;
        this.log("A 0 was played! All hands rotated.");
      } else if (card.value === "7" && !isInitial) {
        this.pendingAction = "chooseSwap";
      }
    }

    acceptDraw(playerId) {
      if (this.winner) return false;
      if (this.players[this.currentTurn] !== playerId) return false;
      if (this.pendingAction) return false;

      let drawCount = this.drawStack > 0 ? this.drawStack : 1;
      const drawn = this.drawCards(drawCount);
      this.hands[playerId].push(...drawn);
      this.log(`Player ${playerId} drew ${drawCount} card(s).`);
      
      this.drawStack = 0;
      this.unoCalled[playerId] = false;
      
      this.nextTurn();
      return true;
    }

    chooseColor(playerId, color) {
      if (this.players[this.currentTurn] !== playerId || this.pendingAction !== "chooseColor") return false;
      if (!COLORS.includes(color)) return false;

      const wasWild4 = this.getTopCard()?.value === "wild4";
      this.activeColor = color;
      this.pendingAction = null;
      this.log(`Color changed to ${color}`);

      if (wasWild4 && this.drawStack >= 4) {
        const challengerIdx = (this.currentTurn + this.direction) % this.players.length;
        const challenger = this.players[challengerIdx < 0 ? challengerIdx + this.players.length : challengerIdx];
        if (challenger !== this.lastWild4Player) {
          this.pendingAction = "challengeWild4";
          this.actionData = { challenger, playedBy: this.lastWild4Player };
          return true;
        }
      }

      this.nextTurn();
      return true;
    }

    /** Next player challenges Wild +4 — must have same color as active (before wild). */
    challengeWild4(challengerId, doChallenge) {
      if (this.pendingAction !== "challengeWild4") return false;
      if (!this.actionData || this.actionData.challenger !== challengerId) return false;

      const playedBy = this.actionData.playedBy;
      this.pendingAction = null;
      this.actionData = null;

      if (!doChallenge) {
        this.log(`${challengerId} accepted +4.`);
        this.nextTurn();
        return true;
      }

      const hand = this.hands[playedBy] || [];
      const hadColor = hand.some((c) => c.color === this.activeColor && c.color !== "wild");
      if (hadColor) {
        const drawn = this.drawCards(4);
        this.hands[playedBy].push(...drawn);
        this.drawStack = 0;
        this.log(`Challenge won! ${playedBy} drew 4 (had ${this.activeColor}).`);
      } else {
        const drawn = this.drawCards(6);
        this.hands[challengerId].push(...drawn);
        this.drawStack = 0;
        this.log(`Challenge failed! ${challengerId} drew 6.`);
      }
      this.nextTurn();
      return true;
    }

    chooseSwap(playerId, targetId) {
      if (this.players[this.currentTurn] !== playerId || this.pendingAction !== "chooseSwap") return false;
      if (!this.players.includes(targetId) || targetId === playerId) return false;

      const temp = this.hands[playerId];
      this.hands[playerId] = this.hands[targetId];
      this.hands[targetId] = temp;
      this.pendingAction = null;
      this.log(`Player ${playerId} swapped hands with ${targetId}`);

      this.checkWin(playerId);
      this.checkWin(targetId);

      if (!this.winner) this.nextTurn();
      return true;
    }

    callUno(playerId) {
      if (this.hands[playerId] && this.hands[playerId].length <= 2) {
        this.unoCalled[playerId] = true;
        this.log(`Player ${playerId} shouted UNO!`);
        return true;
      }
      return false;
    }

    catchUno(callerId, targetId) {
      if (this.hands[targetId] && this.hands[targetId].length === 1 && !this.unoCalled[targetId]) {
        this.hands[targetId].push(...this.drawCards(2));
        this.log(`Player ${targetId} was caught not saying UNO! Drew 2 cards.`);
        return true;
      }
      return false;
    }

    nextTurn(skip = false) {
      if (this.winner) return;
      let steps = skip ? 2 : 1;
      this.currentTurn = (this.currentTurn + (this.direction * steps)) % this.players.length;
      if (this.currentTurn < 0) this.currentTurn += this.players.length;
    }

    checkWin(playerId) {
      if (this.hands[playerId].length === 0) {
        this.winner = playerId;
        this.calculateScores();
        this.log(`Player ${playerId} wins!`);
      }
    }

    calculateScores() {
      let score = 0;
      for (const p of this.players) {
        if (p === this.winner) continue;
        for (const c of this.hands[p]) {
          if (c.value === "wild" || c.value === "wild4") score += 50;
          else if (["skip", "reverse", "draw2"].includes(c.value)) score += 20;
          else score += parseInt(c.value, 10);
        }
      }
      this.scores[this.winner] = score;
    }

    getState(forPlayer) {
      const counts = {};
      this.players.forEach(p => counts[p] = this.hands[p].length);
      
      return {
        players: this.players,
        handCounts: counts,
        myHand: this.hands[forPlayer] || [],
        topCard: this.getTopCard(),
        activeColor: this.activeColor,
        currentTurnId: this.players[this.currentTurn],
        direction: this.direction,
        drawStack: this.drawStack,
        pendingAction: this.pendingAction,
        challengeData: this.pendingAction === "challengeWild4" ? this.actionData : null,
        winner: this.winner,
        scores: this.scores,
        logs: this.logs.slice(-5)
      };
    }
  }

  // Export for both Node.js and Browser
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnoEngine;
  } else {
    global.UnoEngine = UnoEngine;
  }
})(typeof window !== 'undefined' ? window : this);
