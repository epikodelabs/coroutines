import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-container',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  template: `
    <div class="container">
      <header>
        <h1>🍕 swinky Kitchen</h1>
        <p>Actor-based concurrency demo</p>
      </header>
      <main>
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    header {
      margin: 20px 0;
      text-align: center;
    }
    header h1 {
      margin: 0;
      font-size: 2rem;
      color: #ffd700;
    }
    header p {
      margin: 5px 0 0;
      color: #aaa;
      font-size: 0.9rem;
    }
    main {
      width: 100%;
      max-width: 1200px;
      padding: 0 20px 40px;
      box-sizing: border-box;
    }
  `],
})
export class ContainerComponent {}