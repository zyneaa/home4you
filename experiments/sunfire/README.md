# Sunfire Engine

**Sunfire Engine** is a high-performance, personalized ranking and feed architecture designed for dynamic content delivery. It balances user intent, temporal relevance, and ecosystem health to produce a normalized, diverse, and engaging feed. The main engine being used for Home4You's feed service. This repo contains pure mathematical representation for the pipeline with some code for simulation.

The project includes a `Makefile` for streamlined data generation and simulation.

- **Generate Users**:
  ```bash
  make user
  ```
- **Generate Properties**:
  ```bash
  make property
  ```
- **Calculate Scores**:
  ```bash
  make score
  ```
- **Run Full Simulation**:
  ```bash
  make simulate
  ```

## Directory Structure

- `generators/`: Core logic for synthetic data generation and scoring.
  - `user_gen.py`: Generates user profiles and interaction history.
  - `property_gen.py`: Generates property listings with metadata.
  - `score.py`: The main ranking engine implementation.
- `simulators/`: Jupyter notebooks and scripts for experimentation and visualization.
  - `scores.ipynb`: Deep dive into scoring distributions.
  - `normal_simulation.ipynb`: End-to-end feed simulation.
- `parameters.py`: Centralized configuration for all ranking constants (decay rates, weights, thresholds).
- `sunfire.md`: Detailed mathematical documentation of the ranking algorithms.

## Simulation & Visualization

The `simulators/` directory contains tools to visualize the engine's performance. You can find radar charts and bar visualizations (`sunfire_radar_viz.png`, `sunfire_bars_viz.png`) that illustrate how different parameters affect the final ranking.

---
*For a deep dive into the underlying mathematics, refer to [sunfire.md](./sunfire.md).*
