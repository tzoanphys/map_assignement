import { Component, AfterViewInit, inject, ChangeDetectorRef, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import Style from 'ol/style/Style';
import { fromLonLat } from 'ol/proj';
import { getLength, getArea } from 'ol/sphere';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import Feature from 'ol/Feature';

/** Use production API for all deployments (local, Netlify, Render) so Download and data load work everywhere. */
const API = 'https://map-assignement.onrender.com/api';

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
  showInstructions = false;

  /** Number of measurements currently saved (from API / after Finish). */
  savedMeasurementsCount = 0;
  /** Number of measurements when user last downloaded (used for success message). */
  countAtLastDownload = 0;

  /** Download available whenever there are saved measurements (works on local, Netlify, Render). */
  get canDownload(): boolean {
    return this.savedMeasurementsCount > 0;
  }

  openInstructions(): void {
    this.showInstructions = true;
    this.cdr.markForCheck();
    this.cdr.detectChanges();
  }

  closeInstructions(): void {
    this.ngZone.run(() => {
      this.showInstructions = false;
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    });
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.showInstructions) {
      this.closeInstructions();
    }
  }

  /** Bold style so your drawings are clearly separate from map base/attribution */
  private static readonly drawStyle = new Style({
    stroke: new Stroke({ color: '#1565c0', width: 4 }),
    fill: new Fill({ color: 'rgba(21, 101, 192, 0.15)' }),
  });

  ngAfterViewInit(): void {
    this.map = new Map({
      target: 'map',
      layers: [
        new TileLayer({ source: new OSM(), zIndex: 0 }),
        new VectorLayer({ source: this.savedSource, style: App.drawStyle, zIndex: 10 }),
        new VectorLayer({ source: this.pendingSource, style: App.drawStyle, zIndex: 11 }),
      ],
      view: new View({
        center: fromLonLat([4.3517, 50.8503]),
        zoom: 11,
      }),
    });
    this.loadMeasurements();
  }

  loadMeasurements(overrideMessage?: string): void {
    this.savedSource.clear();
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
          this.savedMeasurementsCount = items.length;
          this.lastInfo = overrideMessage ?? (items.length === 0 ? 'No measurements yet. Draw then click Finish to save.' : `${items.length} measurement(s) in database.`);
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
      clickTolerance: 32,
      // Easier to finish: snap to first point from farther away (close polygon / finish line)
      snapTolerance: 40,
      // Longer delay before a click becomes "drag vertex" so clicks register as add-point more reliably
      dragVertexDelay: 1000,
    });
    this.map.addInteraction(this.drawInteraction);
    this.lastInfo = type === 'LineString'
      ? '📈 Draw a line: click to add points, double-click to finish. Then press Finish to save.'
      : '📊 Draw a polygon: click to add corners, click first point to close. Then press Finish to save.';
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
              this.savedMeasurementsCount = this.savedSource.getFeatures().length;
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
    this.savedSource.clear();
    if (this.map) {
      this.pendingSource.changed();
      this.savedSource.changed();
      this.map.render();
    }
    this.savedMeasurementsCount = 0;
    this.countAtLastDownload = 0;
    this.lastInfo = 'Map refreshed. All lines (saved and unsaved) cleared from the map.';
    this.cdr.detectChanges();
  }

  /** Delete only the last (most recent) saved measurement from the database. */
  deleteLastMeasurement(): void {
    if (!confirm('Delete the last saved measurement from the database?')) return;
    this.http.delete<{ deletedCount: number }>(API + '/measurements/latest').subscribe({
      next: (res) => {
        const msg = res.deletedCount === 1 ? 'Last measurement deleted.' : 'No measurement to delete.';
        this.loadMeasurements(msg);
      },
      error: (err) => {
        this.ngZone.run(() => {
          this.lastInfo = err.status === 404 ? 'No measurement to delete.' : 'Failed to delete. Is the server running?';
          this.cdr.detectChanges();
        });
      },
    });
  }

  /** Download saved measurements as a JSON file. Available when there are saved measurements. */
  downloadData(): void {
    if (!this.canDownload) {
      this.lastInfo = 'Draw and click Finish first to save measurements, then you can download.';
      this.cdr.detectChanges();
      return;
    }
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
          this.countAtLastDownload = items.length;
          this.lastInfo = `Downloaded ${items.length} measurement(s).`;
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
