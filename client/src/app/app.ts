import { Component, AfterViewInit, inject, ChangeDetectorRef, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import { fromLonLat } from 'ol/proj';
import { getLength, getArea } from 'ol/sphere';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import Feature from 'ol/Feature';

const API = 'http://localhost:3000/api';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements AfterViewInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  map!: Map;
  /** Saved features (from DB or just saved on Finish). */
  savedSource = new VectorSource();
  /** Drawn in this session; not saved to DB until user clicks Finish. If user does not press Finish, nothing is saved. */
  pendingSource = new VectorSource();
  drawInteraction: Draw | null = null;
  lastInfo: string = 'Loading…';

  ngAfterViewInit(): void {
    this.map = new Map({
      target: 'map',
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({ source: this.savedSource }),
        new VectorLayer({ source: this.pendingSource }),
      ],
      view: new View({
        center: fromLonLat([4.3517, 50.8503]),
        zoom: 11,
      }),
    });
    this.loadMeasurements();
  }

  loadMeasurements(): void {
    this.http.get<Array<{ type: string; geojson: { geometry?: { type: string; coordinates: number[][] | number[][][] } } }>>(API + '/measurements').subscribe({
      next: (items) => {
        this.ngZone.run(() => {
          items.forEach((m) => {
            const geom = m.geojson?.geometry;
            if (!geom || !geom.coordinates) return;
            if (geom.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0 && typeof geom.coordinates[0][0] === 'number') {
              const line = new LineString(geom.coordinates as number[][]).transform('EPSG:4326', 'EPSG:3857');
              this.savedSource.addFeature(new Feature({ geometry: line }));
            } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
              const poly = new Polygon(geom.coordinates as number[][][]).transform('EPSG:4326', 'EPSG:3857');
              this.savedSource.addFeature(new Feature({ geometry: poly }));
            }
          });
          this.lastInfo = items.length === 0 ? 'No measurements yet. Draw then click Finish to save.' : `${items.length} measurement(s) in database.`;
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.lastInfo = 'Could not load measurements. Is the server running?';
          this.cdr.detectChanges();
        });
      },
    });
  }

  setDrawMode(type: 'LineString' | 'Polygon'): void {
    this.stopDrawing();
    const geometryType = type === 'Polygon' ? 'Polygon' : 'LineString';
    this.drawInteraction = new Draw({
      source: this.pendingSource,
      type: geometryType,
      // Easier drawing: allow more pointer movement to still count as a click (add vertex)
      clickTolerance: 20,
      // Easier to finish: snap to first point from farther away (close polygon / finish line)
      snapTolerance: 24,
      // Longer delay before a click becomes "drag vertex" so clicks register as add-point more reliably
      dragVertexDelay: 700,
    });
    this.map.addInteraction(this.drawInteraction);
    this.lastInfo = type === 'LineString' ? '📈 Draw a line. Click Finish to save.' : 'Draw a polygon. Click Finish to save.';
    this.cdr.detectChanges();
  }

  stopDrawing(): void {
    if (this.drawInteraction && this.map) {
      try {
        this.drawInteraction.abortDrawing();
      } catch {
        // no active sketch
      }
      this.map.removeInteraction(this.drawInteraction);
      this.drawInteraction = null;
    }
  }

  finishDrawing(): void {
    this.stopDrawing();
    const features = this.pendingSource.getFeatures();
    if (features.length === 0) {
      this.lastInfo = 'Nothing to save. Draw a line or polygon first, then click Finish.';
      this.cdr.detectChanges();
      return;
    }

    const payloads: { type: string; geojson: object; value: number; unit: string }[] = [];
    for (const feature of features) {
      const geom = feature.getGeometry();
      if (!geom) continue;
      const gType = geom.getType();
      const clone = geom.clone();
      clone.transform('EPSG:3857', 'EPSG:4326');
      let value: number;
      let unit: string;
      let coords: number[][];
      if (gType === 'LineString') {
        const line = clone as LineString;
        coords = line.getCoordinates();
        value = getLength(line, { projection: 'EPSG:4326' });
        unit = 'm';
      } else if (gType === 'Polygon') {
        const poly = clone as Polygon;
        coords = poly.getCoordinates()[0];
        value = getArea(poly, { projection: 'EPSG:4326' });
        unit = 'm²';
      } else continue;
      const geojson = {
        type: 'Feature' as const,
        geometry: { type: gType as 'LineString' | 'Polygon', coordinates: gType === 'Polygon' ? [coords] : coords },
      };
      payloads.push({ type: gType, geojson, value, unit });
    }

    let done = 0;
    let failed = false;
    const total = payloads.length;
    if (total === 0) {
      this.lastInfo = 'Nothing to save.';
      this.cdr.detectChanges();
      return;
    }
    payloads.forEach((body) => {
      this.http.post(API + '/measurements', body).subscribe({
        next: () => {
          this.ngZone.run(() => {
            done++;
            if (!failed && done === total) {
              features.forEach((f) => this.savedSource.addFeature(f));
              this.pendingSource.clear();
              this.lastInfo = '✅Your data are saved and are available.';
              this.cdr.detectChanges();
            }
          });
        },
        error: () => {
          this.ngZone.run(() => {
            failed = true;
            this.lastInfo = '❌Failed to save. Is the server running?';
            this.cdr.detectChanges();
          });
        },
      });
    });
  }

  reset(): void {
    this.stopDrawing();
    this.pendingSource.clear();
    // Force map to repaint so unsaved lines disappear immediately
    if (this.map) {
      this.pendingSource.changed();
      this.map.render();
    }
    this.lastInfo = 'Unsaved drawings cleared. Your saved data in the database are unchanged.';
    this.cdr.detectChanges();
  }

  clearDatabase(): void {
    if (!confirm('Clear all measurements from the database? This cannot be undone.')) return;
    this.http.delete<{ deletedCount: number }>(API + '/measurements').subscribe({
      next: (res) => {
        this.ngZone.run(() => {
          this.savedSource.clear();
          this.lastInfo = `Database cleared. ${res.deletedCount} measurement(s) removed.`;
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.lastInfo = 'Failed to clear database. Is the server running?';
          this.cdr.detectChanges();
        });
      },
    });
  }

  /** Download saved measurements as a JSON file (available after Finish). */
  downloadData(): void {
    this.http.get<unknown[]>(API + '/measurements').subscribe({
      next: (items) => {
        const json = JSON.stringify(items, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `measurements_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.ngZone.run(() => {
          this.lastInfo = items.length === 0 ? 'No data to download. Draw and click Finish first.' : `Downloaded ${items.length} measurement(s).`;
          this.cdr.detectChanges();
        });
      },
      error: () => {
        this.ngZone.run(() => {
          this.lastInfo = 'Download failed. Is the server running?';
          this.cdr.detectChanges();
        });
      },
    });
  }
}
