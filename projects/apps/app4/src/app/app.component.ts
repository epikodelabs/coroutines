import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import type { TerritoryWarsState } from '../territory-wars.service';
import { TerritoryWarsService } from '../territory-wars.service';

function getHoshiSet(size: number): Set<string> {
  const set = new Set<string>();
  const add = (row: number, col: number) => set.add(`${row},${col}`);

  if (size === 9) {
    [2, 6].forEach((point) => {
      add(point, 2);
      add(point, 6);
    });
    add(4, 4);
  } else if (size === 11) {
    [2, 8].forEach((point) => {
      add(point, 2);
      add(point, 8);
    });
    add(5, 5);
  } else if (size === 13) {
    [3, 9].forEach((point) => {
      add(point, 3);
      add(point, 9);
    });
    add(6, 6);
  } else if (size === 19) {
    [3, 9, 15].forEach((row) => [3, 9, 15].forEach((col) => add(row, col)));
  } else {
    const quarter = Math.floor((size - 1) / 4);
    const middle = Math.floor((size - 1) / 2);
    add(quarter, quarter);
    add(quarter, size - 1 - quarter);
    add(size - 1 - quarter, quarter);
    add(size - 1 - quarter, size - 1 - quarter);
    add(middle, middle);
  }

  return set;
}

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <div class="tw-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">coroutines Actors + Angular</p>
          <h1>Territory Wars</h1>
          <p class="hero-text">
            @if (state(); as game) {
              {{ subtitle(game) }}
            } @else {
              Starting match...
            }
          </p>
        </div>
        <div class="rules-card">
          <strong>Rules</strong>
          <p>Place a stone on any empty point. Surrounded groups are captured. Score is stones plus enclosed territory.</p>
        </div>
      </header>

      <section class="toolbar">
        <div class="toolbar-group size-picker">
          <span class="toolbar-label">Board</span>
          <button [class.active]="currentSize() === 9" (click)="startMatch(9)">9 × 9</button>
          <button [class.active]="currentSize() === 11" (click)="startMatch(11)">11 × 11</button>
          <button [class.active]="currentSize() === 13" (click)="startMatch(13)">13 × 13</button>
        </div>

        <div class="toolbar-group">
          <span class="toolbar-label">Match</span>
          <button (click)="startMatch(currentSize())">New Match</button>
          <button (click)="pass()" [disabled]="!canPass()">Pass Turn</button>
        </div>
      </section>

      @if (state(); as game) {
        <section class="dashboard">
          <article class="score-panel user-panel">
            <span class="panel-label">User Score</span>
            <strong>{{ game.score.user }}</strong>
            <span class="panel-meta">Territory <b>{{ territoryScore(game, 'user') }}</b></span>
            <span class="panel-meta">Captures <b>{{ game.captures.user }}</b></span>
          </article>

          <article class="center-panel">
            <span class="panel-label">Board State</span>
            <strong>{{ game.message }}</strong>
            <span class="panel-meta">Legal moves: user {{ game.legalMoves.user }}, rival {{ game.legalMoves.rival }}</span>
          </article>

          <article class="score-panel rival-panel">
            <span class="panel-label">Rival Score</span>
            <strong>{{ game.score.rival }}</strong>
            <span class="panel-meta">Territory <b>{{ territoryScore(game, 'rival') }}</b></span>
            <span class="panel-meta">Captures <b>{{ game.captures.rival }}</b></span>
          </article>
        </section>

        <section class="board-stage">
          <div class="board-frame">
            <div class="board-mount">
              <div
                class="board-grid"
                [style.gridTemplateColumns]="'repeat(' + game.size + ', minmax(0, 1fr))'"
                [style.gridTemplateRows]="'repeat(' + game.size + ', minmax(0, 1fr))'"
              >
                @for (row of game.board; track $index; let rowIndex = $index) {
                  @for (cell of row; track $index; let colIndex = $index) {
                    <button
                      type="button"
                      class="board-cell"
                      [class.user]="cell === 1"
                      [class.rival]="cell === 2"
                      [class.territory-user]="game.status === 'finished' && cell === 0 && game.territory[rowIndex][colIndex] === 1"
                      [class.territory-rival]="game.status === 'finished' && cell === 0 && game.territory[rowIndex][colIndex] === 2"
                      [class.last-move]="isLastMove(game, rowIndex, colIndex)"
                      [class.interactive]="canPlace(game, rowIndex, colIndex)"
                      [class.hoshi]="cell === 0 && isHoshi(rowIndex, colIndex)"
                      [disabled]="!canPlace(game, rowIndex, colIndex)"
                      [attr.aria-label]="'Row ' + (rowIndex + 1) + ' column ' + (colIndex + 1)"
                      (click)="place(rowIndex, colIndex, game)"
                    ></button>
                  }
                }
              </div>
            </div>
          </div>
        </section>

        <section class="notes">
          <p><strong>Actors:</strong> the user actor forwards clicks, the game actor owns rules and scoring, and the rival actor evaluates responses before playing back into the match.</p>
          <p><strong>Angular UI:</strong> the board now renders through a normal Angular template while the worker-driven actor model stays intact.</p>
        </section>
      }
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  readonly state = this.service.state;
  readonly currentSize = signal(11);
  readonly hoshiSet = computed(() => getHoshiSet(this.currentSize()));

  constructor(private readonly service: TerritoryWarsService) {}

  ngOnInit(): void {
    this.startMatch(this.currentSize());
  }

  ngOnDestroy(): void {
    void this.service.destroy();
  }

  startMatch(size: number): void {
    this.currentSize.set(size);
    this.service.start(size);
  }

  pass(): void {
    if (!this.canPass()) {
      return;
    }
    this.service.pass();
  }

  place(row: number, col: number, game: TerritoryWarsState): void {
    if (!this.canPlace(game, row, col)) {
      return;
    }
    this.service.place(row, col);
  }

  canPass(): boolean {
    const game = this.state();
    return !!game && game.status === 'playing' && game.currentPlayer === 'user' && !game.pendingRival;
  }

  canPlace(game: TerritoryWarsState, row: number, col: number): boolean {
    return game.status === 'playing' && game.currentPlayer === 'user' && !game.pendingRival && game.board[row][col] === 0;
  }

  isHoshi(row: number, col: number): boolean {
    return this.hoshiSet().has(`${row},${col}`);
  }

  isLastMove(game: TerritoryWarsState, row: number, col: number): boolean {
    return game.lastMove?.row === row && game.lastMove?.col === col;
  }

  territoryScore(game: TerritoryWarsState, player: 'user' | 'rival'): number {
    return Math.max(0, game.score[player] - game.stones[player]);
  }

  subtitle(game: TerritoryWarsState): string {
    const winnerLabel =
      game.winner === 'draw'
        ? 'Draw'
        : game.winner === 'user'
          ? 'User leads'
          : game.winner === 'rival'
            ? 'Rival leads'
            : game.currentPlayer === 'user'
              ? 'Your turn'
              : 'Rival turn';

    if (game.status === 'finished') {
      return `Match finished after ${game.moveCount} turns. ${winnerLabel}.`;
    }

    if (game.pendingRival) {
      return 'Your actor handed the board to the rival actor. The worker is thinking...';
    }

    return 'Place a stone to grow territory, pressure groups, and force captures.';
  }
}