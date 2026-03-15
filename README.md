# Thermatras - Installatie Scanner & Isolatie Uitslag Tool

Interactive demo tool for pipe insulation scanning, AI component detection, insulation configuration, and nested cutting pattern generation.

## Features

- **Installation Builder** - Build pipe installations from 7 component types (straight, elbow, T-piece, reducer, flange, valve, expansion joint) with 9 preset configurations
- **3D Room Scanner** - Simulated LiDAR 4-phase scanning with animated scan beam, point cloud generation, and AI detection visualization
- **ML Component Detection** - Per-component confidence bars showing AI detection accuracy
- **Insulation Configurator** - 5 materials, 4 cladding types, thermal heat map visualization, material cost calculator
- **Nested Cutting Patterns** - Professional uitslag generation with sheet nesting, material utilization tracking, cut order numbering, zoom/pan, SVG/DXF export

## Demo Workflow

1. **Installatie** - Select preset or build custom pipe installation
2. **Scanner** - Run simulated 3D LiDAR room scan with AI detection
3. **Isolatie** - Configure insulation parameters with live 3D preview
4. **Uitslag** - View nested cutting patterns on standard sheet sizes

## Tech Stack

- Pure HTML/CSS/JavaScript (no build step)
- Three.js r128 for 3D visualization
- Canvas 2D for cutting pattern rendering

## Live Demo

[Open Demo](https://rickv78.github.io/Thermatras/)

## Screenshot

![Thermatras Demo](screenshot.png)

## Running Locally

Simply open `index.html` in a modern browser. No server or build step required.
