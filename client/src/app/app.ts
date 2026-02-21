import { Component, AfterViewInit } from '@angular/core';

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat } from 'ol/proj';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements AfterViewInit {

  map!: Map;
  lastInfo: string | null = null;

  ngAfterViewInit(): void {
    this.map = new Map({
      target: 'map',
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
      ],
      view: new View({
        center: fromLonLat([4.3517, 50.8503]), // Brussels
        zoom: 11,
      }),
    });
  }

  setDrawMode(type: 'LineString' | 'Polygon') {
    console.log("Draw mode:", type);
  }

  stopDrawing() {
    console.log("Stop drawing");
  }
}