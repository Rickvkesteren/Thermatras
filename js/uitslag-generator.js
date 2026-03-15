/**
 * UitslagGenerator v4.0 - Professionele 2D vlakke uitslagen met nesting
 * Features: sheet nesting, materiaaloptimalisatie, snijvolgorde, kleurcodering,
 * zoom/pan, grid achtergrond, componentnummering, afvalberekening
 */
class UitslagGenerator {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.patterns = [];
        this.nestedSheets = [];
        this.options = {
            scale: 'fit',
            units: 'mm',
            showFoldLines: true,
            showDimensions: true,
            showOverlap: true,
            showNesting: true,
            showGrid: true,
            showCutOrder: true,
            sheetWidth: 1250,
            sheetHeight: 2500,
            nestingGap: 8
        };
        this.PADDING = 60;
        this.SPACING = 50;
        this.filterVisible = new Set();
        this._panX = 0;
        this._panY = 0;
        this._zoom = 1;
        this._dragging = false;
        this._lastMouse = null;
        this._initInteraction();
    }

    _initInteraction() {
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            this._panX = mx - (mx - this._panX) * delta;
            this._panY = my - (my - this._panY) * delta;
            this._zoom *= delta;
            this._zoom = Math.max(0.1, Math.min(5, this._zoom));
            this.draw();
        });
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0 || e.button === 2) {
                this._dragging = true;
                this._lastMouse = { x: e.clientX, y: e.clientY };
            }
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (this._dragging && this._lastMouse) {
                this._panX += e.clientX - this._lastMouse.x;
                this._panY += e.clientY - this._lastMouse.y;
                this._lastMouse = { x: e.clientX, y: e.clientY };
                this.draw();
            }
        });
        this.canvas.addEventListener('mouseup', () => { this._dragging = false; });
        this.canvas.addEventListener('mouseleave', () => { this._dragging = false; });
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    generate(components, insParams) {
        this.patterns = [];
        for (const comp of components) {
            if (comp.type === 'flange') continue;
            const pattern = this._generatePattern(comp, insParams);
            if (pattern) {
                this.patterns.push(pattern);
                this.filterVisible.add(comp.id);
            }
        }
        this._nestPatterns();
        return this.patterns;
    }

    generateFromGeometry(components, insParams) {
        this.patterns = [];
        for (const comp of components) {
            if (comp.type === 'flange') continue;
            const dx = comp.endPos.x - comp.startPos.x;
            const dy = comp.endPos.y - comp.startPos.y;
            const dz = comp.endPos.z - comp.startPos.z;
            const geoLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const effectiveLength = comp.length || Math.round(geoLength);
            const enriched = {
                ...comp,
                length: effectiveLength,
                _geoLength: geoLength,
                _bbox: {
                    width: Math.abs(dx) + comp.diameter,
                    height: Math.abs(dy) + comp.diameter,
                    depth: Math.abs(dz) + comp.diameter
                }
            };
            const pattern = this._generatePattern(enriched, insParams);
            if (pattern) {
                pattern.bbox = enriched._bbox;
                pattern.geoLength = geoLength;
                this.patterns.push(pattern);
                this.filterVisible.add(comp.id);
            }
        }
        this._nestPatterns();
        return this.patterns;
    }

    /* ===== NESTING ALGORITHM ===== */
    _nestPatterns() {
        const gap = this.options.nestingGap;
        const sheetW = this.options.sheetWidth;
        const sheetH = this.options.sheetHeight;

        const allSegs = [];
        let cutOrder = 1;
        for (const pattern of this.patterns) {
            if (!this.filterVisible.has(pattern.componentId)) continue;
            for (const seg of pattern.segments) {
                const w = this._segWidth(seg);
                const h = this._segHeight(seg);
                allSegs.push({
                    seg, pattern,
                    w: w + gap, h: h + gap,
                    rawW: w, rawH: h,
                    cutOrder: cutOrder++,
                    placed: false, sheetIdx: -1,
                    nx: 0, ny: 0, rotated: false
                });
            }
        }

        allSegs.sort((a, b) => b.h - a.h || b.w - a.w);

        this.nestedSheets = [];
        for (const item of allSegs) {
            let placed = false;
            for (let si = 0; si < this.nestedSheets.length && !placed; si++) {
                placed = this._tryPlaceOnSheet(this.nestedSheets[si], item, sheetW, sheetH);
            }
            if (!placed) {
                const rotItem = { ...item, w: item.h, h: item.w, rawW: item.rawH, rawH: item.rawW, rotated: true };
                for (let si = 0; si < this.nestedSheets.length && !placed; si++) {
                    placed = this._tryPlaceOnSheet(this.nestedSheets[si], rotItem, sheetW, sheetH);
                    if (placed) {
                        item.rotated = true;
                        item.nx = rotItem.nx;
                        item.ny = rotItem.ny;
                        item.sheetIdx = rotItem.sheetIdx;
                    }
                }
            }
            if (!placed) {
                const sheet = { items: [], shelves: [{ y: 0, h: 0, xCursor: 0 }], usedArea: 0 };
                this.nestedSheets.push(sheet);
                item.sheetIdx = this.nestedSheets.length - 1;
                this._tryPlaceOnSheet(sheet, item, sheetW, sheetH);
            }
        }

        for (const item of allSegs) {
            item.seg._nested = {
                sheetIdx: item.sheetIdx,
                x: item.nx, y: item.ny,
                rotated: item.rotated,
                cutOrder: item.cutOrder
            };
        }
    }

    _tryPlaceOnSheet(sheet, item, sheetW, sheetH) {
        for (const shelf of sheet.shelves) {
            if (shelf.xCursor + item.w <= sheetW && shelf.y + Math.max(shelf.h, item.h) <= sheetH) {
                item.nx = shelf.xCursor;
                item.ny = shelf.y;
                item.sheetIdx = this.nestedSheets.indexOf(sheet);
                shelf.xCursor += item.w;
                shelf.h = Math.max(shelf.h, item.h);
                sheet.items.push(item);
                sheet.usedArea += item.rawW * item.rawH;
                return true;
            }
        }
        const lastShelf = sheet.shelves[sheet.shelves.length - 1];
        const newY = lastShelf.y + lastShelf.h;
        if (newY + item.h <= sheetH && item.w <= sheetW) {
            const newShelf = { y: newY, h: item.h, xCursor: item.w };
            sheet.shelves.push(newShelf);
            item.nx = 0;
            item.ny = newY;
            item.sheetIdx = this.nestedSheets.indexOf(sheet);
            sheet.items.push(item);
            sheet.usedArea += item.rawW * item.rawH;
            return true;
        }
        return false;
    }

    _generatePattern(comp, ins) {
        const r = comp.diameter / 2;
        const thick = ins.thickness;
        const overlap = ins.overlap || 0;
        const outerR = r + thick;
        const circumference = Math.PI * 2 * outerR;
        const patternW = circumference + overlap;

        const typeColors = {
            'straight': '#4caf50', 'elbow': '#ff9800', 't-piece': '#2196f3',
            'reducer': '#9c27b0', 'valve': '#f44336', 'expansion-joint': '#00bcd4'
        };
        const color = typeColors[comp.type] || '#666';

        switch (comp.type) {
            case 'straight':
            case 'expansion-joint': {
                const nSeg = ins.numSegments || 2;
                const segLen = comp.length / nSeg;
                const segments = [];
                for (let i = 0; i < nSeg; i++) {
                    segments.push({
                        subType: 'rect',
                        label: `${comp.type === 'expansion-joint' ? 'Comp.' : 'Buis'} #${comp.id}-${i + 1}`,
                        width: patternW, height: segLen, overlap,
                        diameter: comp.diameter, thickness: thick, color
                    });
                }
                return {
                    componentId: comp.id, type: comp.type,
                    label: comp.type === 'expansion-joint' ? `Compensator #${comp.id}` : `Rechte buis #${comp.id}`,
                    diameter: comp.diameter, segments
                };
            }
            case 'elbow': {
                const angleRad = (Math.abs(comp.bendAngle) * Math.PI) / 180;
                const bendR = comp.bendRadius;
                const goreCount = Math.max(2, Math.ceil(Math.abs(comp.bendAngle) / 15));
                const goreAngle = angleRad / goreCount;
                const gores = [];
                for (let i = 0; i < goreCount; i++) {
                    const points = [];
                    const steps = 40;
                    for (let s = 0; s <= steps; s++) {
                        const theta = (s / steps) * Math.PI * 2;
                        const localR = outerR;
                        const arcLen = (bendR + localR * Math.cos(theta)) * goreAngle;
                        points.push({ x: (s / steps) * circumference, y: arcLen });
                    }
                    gores.push({
                        subType: 'gore',
                        label: `Bocht #${comp.id}-G${i + 1}`,
                        points, width: circumference + overlap, overlap,
                        diameter: comp.diameter, thickness: thick,
                        bendAngle: comp.bendAngle, goreIndex: i, goreCount, color
                    });
                }
                return {
                    componentId: comp.id, type: 'elbow',
                    label: `Bocht #${comp.id} (${comp.bendAngle}\u00B0)`,
                    diameter: comp.diameter, segments: gores
                };
            }
            case 't-piece': {
                const mainW = patternW;
                const mainH = comp.length;
                const branchR = r * 0.8;
                const branchOuterR = branchR + thick;
                const branchCirc = Math.PI * 2 * branchOuterR;
                const holeR = branchOuterR;
                return {
                    componentId: comp.id, type: 't-piece',
                    label: `T-stuk #${comp.id}`,
                    diameter: comp.diameter,
                    segments: [
                        {
                            subType: 't-main',
                            label: `T-stuk #${comp.id}-H`,
                            width: mainW, height: mainH, overlap, holeR,
                            holePosY: mainH / 2, diameter: comp.diameter, thickness: thick, color
                        },
                        {
                            subType: 'saddle',
                            label: `T-stuk #${comp.id}-Z`,
                            width: branchCirc + overlap, height: branchOuterR * 1.5,
                            overlap, outerR: branchOuterR, pipeOuterR: outerR,
                            diameter: branchR * 2, thickness: thick, color
                        }
                    ]
                };
            }
            case 'reducer': {
                const endR = (comp.endDiameter || comp.diameter * 0.7) / 2;
                const outerR1 = r + thick;
                const outerR2 = endR + thick;
                const slantH = Math.sqrt(comp.length * comp.length + (outerR1 - outerR2) * (outerR1 - outerR2));
                const sectorR1 = slantH * outerR1 / (outerR1 - outerR2 || 0.001);
                const sectorR2 = sectorR1 - slantH;
                const sectorAngle = (outerR1 * 2 * Math.PI) / sectorR1;
                return {
                    componentId: comp.id, type: 'reducer',
                    label: `Verloop #${comp.id} (\u00D8${comp.diameter}\u2192\u00D8${comp.endDiameter || Math.round(comp.diameter * 0.7)})`,
                    diameter: comp.diameter,
                    segments: [{
                        subType: 'cone',
                        label: `Verloop #${comp.id}`,
                        sectorR1: Math.abs(sectorR1), sectorR2: Math.abs(sectorR2),
                        sectorAngle: Math.min(sectorAngle, Math.PI * 2),
                        overlap, diameter: comp.diameter, endDiameter: comp.endDiameter,
                        thickness: thick, length: comp.length, color
                    }]
                };
            }
            case 'valve': {
                const vLen = comp.valveLength || 200;
                return {
                    componentId: comp.id, type: 'valve',
                    label: `Afsluiter #${comp.id} (${comp.valveType || 'kogelkraan'})`,
                    diameter: comp.diameter,
                    segments: [
                        {
                            subType: 'valve-box',
                            label: `Klep #${comp.id}-B`,
                            width: outerR * 2.2 * 2 + overlap, height: vLen,
                            overlap, diameter: comp.diameter, thickness: thick,
                            valveType: comp.valveType, color
                        },
                        {
                            subType: 'valve-box',
                            label: `Klep #${comp.id}-Z`,
                            width: outerR * 2.2 * 2 + overlap, height: outerR * 2.2 * 2,
                            overlap, diameter: comp.diameter, thickness: thick, color
                        }
                    ]
                };
            }
            default:
                return null;
        }
    }

    /* ===== DRAWING ===== */
    draw() {
        const ctx = this.ctx;
        const container = this.canvas.parentElement;
        const cw = container.clientWidth || 1200;
        const ch = container.clientHeight || 800;
        this.canvas.width = cw;
        this.canvas.height = ch;

        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, cw, ch);
        ctx.save();
        ctx.translate(this._panX, this._panY);

        let baseScale = 1;
        if (this.options.scale === 'fit') {
            const sheetW = this.options.sheetWidth;
            const sheetH = this.options.sheetHeight;
            const sheetsCount = Math.max(1, this.nestedSheets.length);
            const totalW = sheetW * sheetsCount + this.PADDING * (sheetsCount + 1);
            baseScale = Math.min(cw / totalW, (ch - 80) / (sheetH + this.PADDING * 2), 1.2);
        } else {
            const scaleMap = { '1:1': 1, '1:2': 0.5, '1:5': 0.2, '1:10': 0.1 };
            baseScale = scaleMap[this.options.scale] || 1;
        }
        const s = baseScale * this._zoom;
        ctx.scale(s, s);

        if (this.options.showNesting && this.nestedSheets.length > 0) {
            this._drawNestedSheets(ctx);
        } else {
            this._drawFlatLayout(ctx);
        }
        ctx.restore();
        this._drawHUD(ctx, cw, ch);
    }

    _drawNestedSheets(ctx) {
        const sheetW = this.options.sheetWidth;
        const sheetH = this.options.sheetHeight;
        const gap = this.options.nestingGap;

        ctx.fillStyle = '#1a1a2e';
        ctx.font = 'bold 16px Segoe UI, sans-serif';
        ctx.fillText('Thermatras \u2014 Geneste Isolatie-uitslagen', this.PADDING, 24);

        for (let si = 0; si < this.nestedSheets.length; si++) {
            const sheet = this.nestedSheets[si];
            const ox = this.PADDING + si * (sheetW + this.PADDING);
            const oy = this.PADDING + 40;

            ctx.fillStyle = '#333';
            ctx.font = 'bold 14px Segoe UI, sans-serif';
            ctx.fillText(`Plaat ${si + 1} (${sheetW}\u00D7${sheetH} mm)`, ox, oy - 12);

            this._drawSheetBackground(ctx, ox, oy, sheetW, sheetH);

            const usedArea = sheet.usedArea || 0;
            const totalArea = sheetW * sheetH;
            const usagePercent = Math.round((usedArea / totalArea) * 100);
            this._drawUsageBar(ctx, ox, oy + sheetH + 10, sheetW, usagePercent);

            for (const item of sheet.items) {
                if (!this.filterVisible.has(item.pattern.componentId)) continue;
                const nested = item.seg._nested;
                if (!nested) continue;

                ctx.save();
                ctx.translate(ox + nested.x + gap / 2, oy + nested.y + gap / 2);
                if (nested.rotated) {
                    ctx.translate(item.rawH, 0);
                    ctx.rotate(Math.PI / 2);
                }

                const color = item.seg.color || '#666';
                ctx.fillStyle = color + '15';
                ctx.fillRect(-2, -2, item.rawW + 4, item.rawH + 4);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.strokeRect(-1, -1, item.rawW + 2, item.rawH + 2);

                this._drawSegmentContent(ctx, item.seg, item.rawW, item.rawH);

                if (this.options.showCutOrder) {
                    this._drawCutOrderBadge(ctx, nested.cutOrder, color);
                }
                ctx.fillStyle = '#333';
                ctx.font = 'bold 9px Segoe UI, sans-serif';
                ctx.fillText(item.seg.label, 4, -4);
                ctx.restore();
            }
        }
    }

    _drawSheetBackground(ctx, x, y, w, h) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x + 4, y + 4, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        if (this.options.showGrid) {
            ctx.strokeStyle = '#e8e8e8';
            ctx.lineWidth = 0.3;
            const gridStep = 100;
            for (let gx = gridStep; gx < w; gx += gridStep) {
                ctx.beginPath(); ctx.moveTo(x + gx, y); ctx.lineTo(x + gx, y + h); ctx.stroke();
            }
            for (let gy = gridStep; gy < h; gy += gridStep) {
                ctx.beginPath(); ctx.moveTo(x, y + gy); ctx.lineTo(x + w, y + gy); ctx.stroke();
            }
            ctx.strokeStyle = '#d0d0d0';
            ctx.lineWidth = 0.5;
            for (let gx = 500; gx < w; gx += 500) {
                ctx.beginPath(); ctx.moveTo(x + gx, y); ctx.lineTo(x + gx, y + h); ctx.stroke();
            }
            for (let gy = 500; gy < h; gy += 500) {
                ctx.beginPath(); ctx.moveTo(x, y + gy); ctx.lineTo(x + w, y + gy); ctx.stroke();
            }
        }

        ctx.fillStyle = '#999';
        ctx.font = '7px Segoe UI, sans-serif';
        for (let gx = 0; gx <= w; gx += 500) {
            ctx.fillText(`${gx}`, x + gx + 2, y - 2);
        }
        for (let gy = 500; gy <= h; gy += 500) {
            ctx.save();
            ctx.translate(x - 3, y + gy);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(`${gy}`, 2, 0);
            ctx.restore();
        }
    }

    _drawUsageBar(ctx, x, y, w, percent) {
        const barH = 8;
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(x, y, w, barH);
        const color = percent > 80 ? '#4caf50' : percent > 50 ? '#ff9800' : '#f44336';
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w * percent / 100, barH);
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, w, barH);
        ctx.fillStyle = '#333';
        ctx.font = 'bold 9px Segoe UI, sans-serif';
        ctx.fillText(`Materiaalbenutting: ${percent}%  |  Afval: ${100 - percent}%`, x + 4, y + barH + 12);
    }

    _drawCutOrderBadge(ctx, order, color) {
        const bx = -8, by = -8, br = 10;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px Segoe UI, sans-serif';
        const text = '' + order;
        ctx.fillText(text, bx - ctx.measureText(text).width / 2, by + 3);
    }

    _drawSegmentContent(ctx, seg) {
        switch (seg.subType) {
            case 'rect': this._drawRect(ctx, seg); break;
            case 'gore': this._drawGore(ctx, seg); break;
            case 't-main': this._drawTMain(ctx, seg); break;
            case 'saddle': this._drawSaddle(ctx, seg); break;
            case 'cone': this._drawCone(ctx, seg); break;
            case 'valve-box': this._drawValveBox(ctx, seg); break;
        }
    }

    _drawFlatLayout(ctx) {
        const layouts = this._layoutPatternsFlat();
        ctx.fillStyle = '#333';
        ctx.font = 'bold 16px Segoe UI, sans-serif';
        ctx.fillText('Thermatras \u2014 Isolatie Uitslagen', this.PADDING, 30);
        for (const item of layouts.items) {
            if (!this.filterVisible.has(item.componentId)) continue;
            this._drawSegment(ctx, item);
        }
    }

    _layoutPatternsFlat() {
        const items = [];
        let curX = this.PADDING, curY = this.PADDING + 30, rowH = 0;
        const maxWidth = 3000;
        for (const pattern of this.patterns) {
            for (const seg of pattern.segments) {
                const w = this._segWidth(seg) + 40;
                const h = this._segHeight(seg) + 80;
                if (curX + w > maxWidth) { curX = this.PADDING; curY += rowH + this.SPACING; rowH = 0; }
                items.push({ componentId: pattern.componentId, seg, x: curX, y: curY, w, h, patternLabel: pattern.label });
                curX += w + this.SPACING;
                rowH = Math.max(rowH, h);
            }
        }
        const totalW = items.reduce((m, i) => Math.max(m, i.x + i.w), 600);
        const totalH = items.reduce((m, i) => Math.max(m, i.y + i.h), 400);
        return { items, totalWidth: totalW, totalHeight: totalH };
    }

    _drawHUD(ctx, cw, ch) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(26, 26, 46, 0.85)';
        const hudW = 200;
        ctx.fillRect(cw - hudW - 10, ch - 36, hudW, 28);
        ctx.fillStyle = '#b0bec5';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.fillText(`Zoom: ${Math.round(this._zoom * 100)}%  |  Platen: ${this.nestedSheets.length}`, cw - hudW - 2, ch - 17);
        ctx.restore();
    }

    _segWidth(seg) {
        if (seg.subType === 'cone') return Math.abs(seg.sectorR1) * 2 + 40;
        return seg.width || 200;
    }

    _segHeight(seg) {
        if (seg.subType === 'gore') return Math.max(...seg.points.map(p => p.y)) * 2 + 20;
        if (seg.subType === 'cone') return Math.abs(seg.sectorR1) * 2 + 40;
        return seg.height || 200;
    }

    _drawSegment(ctx, item) {
        const { seg, x, y } = item;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#333';
        ctx.font = 'bold 11px Segoe UI, sans-serif';
        ctx.fillText(seg.label, 0, -6);
        const color = seg.color || '#666';
        ctx.fillStyle = color + '10';
        ctx.fillRect(-2, -2, this._segWidth(seg) + 4, this._segHeight(seg) + 4);
        this._drawSegmentContent(ctx, seg);
        ctx.restore();
    }

    _drawRect(ctx, seg) {
        const { width, height, overlap } = seg;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, 0, width, height);

        ctx.strokeStyle = (seg.color || '#666') + '30';
        ctx.lineWidth = 0.3;
        for (let d = 20; d < width + height; d += 20) {
            ctx.beginPath();
            ctx.moveTo(Math.max(0, d - height), Math.min(height, d));
            ctx.lineTo(Math.min(width, d), Math.max(0, d - width));
            ctx.stroke();
        }

        if (this.options.showOverlap && overlap > 0) {
            ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';
            ctx.fillRect(width - overlap, 0, overlap, height);
            ctx.strokeStyle = '#ff9800';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(width - overlap, 0); ctx.lineTo(width - overlap, height); ctx.stroke();
            ctx.setLineDash([]);
        }
        if (this.options.showFoldLines) {
            ctx.strokeStyle = '#2196f3';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([6, 3]);
            for (const q of [0.25, 0.5, 0.75]) {
                ctx.beginPath(); ctx.moveTo(width * q, 0); ctx.lineTo(width * q, height); ctx.stroke();
            }
            ctx.setLineDash([]);
        }
        if (this.options.showDimensions) {
            this._dimH(ctx, 0, height + 15, width, this._fmt(width));
            this._dimV(ctx, width + 15, 0, height, this._fmt(height));
        }
    }

    _drawGore(ctx, seg) {
        const { points, width, overlap } = seg;
        if (!points || points.length < 2) return;
        const maxY = Math.max(...points.map(p => p.y));

        ctx.fillStyle = (seg.color || '#ff9800') + '12';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (const p of points) ctx.lineTo(p.x, p.y);
        for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i].x, maxY * 2 - points[i].y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(points[0].x, 0);
        for (const p of points) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(points[0].x, maxY * 2);
        for (const p of points) ctx.lineTo(p.x, maxY * 2 - p.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, points[0].y);
        ctx.lineTo(0, maxY * 2 - points[0].y);
        ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.lineTo(points[points.length - 1].x, maxY * 2 - points[points.length - 1].y);
        ctx.stroke();

        if (this.options.showOverlap && overlap > 0) {
            ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';
            const circum = width - overlap;
            ctx.fillRect(circum, 0, overlap, maxY * 2);
            ctx.strokeStyle = '#ff9800';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(circum, 0); ctx.lineTo(circum, maxY * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
        if (this.options.showFoldLines) {
            ctx.strokeStyle = '#2196f3';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([6, 3]);
            ctx.beginPath(); ctx.moveTo(0, maxY); ctx.lineTo(width, maxY); ctx.stroke();
            ctx.setLineDash([]);
        }
        if (this.options.showDimensions) {
            this._dimH(ctx, 0, maxY * 2 + 15, width, this._fmt(width));
            this._dimV(ctx, width + 15, 0, maxY * 2, this._fmt(maxY * 2));
        }
    }

    _drawTMain(ctx, seg) {
        const { width, height, overlap, holeR, holePosY } = seg;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, 0, width, height);

        ctx.strokeStyle = (seg.color || '#2196f3') + '20';
        ctx.lineWidth = 0.3;
        for (let d = 20; d < width + height; d += 20) {
            ctx.beginPath();
            ctx.moveTo(Math.max(0, d - height), Math.min(height, d));
            ctx.lineTo(Math.min(width, d), Math.max(0, d - width));
            ctx.stroke();
        }

        ctx.strokeStyle = '#d32f2f';
        ctx.lineWidth = 1.5;
        const hx = width / 2;
        ctx.beginPath();
        ctx.ellipse(hx, holePosY, holeR, holeR * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(211, 47, 47, 0.08)';
        ctx.fill();

        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#d32f2f';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(hx - holeR - 10, holePosY); ctx.lineTo(hx + holeR + 10, holePosY); ctx.stroke();
        ctx.setLineDash([]);

        if (this.options.showOverlap && overlap > 0) {
            ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';
            ctx.fillRect(width - overlap, 0, overlap, height);
        }
        if (this.options.showDimensions) {
            this._dimH(ctx, 0, height + 15, width, this._fmt(width));
            this._dimV(ctx, width + 15, 0, height, this._fmt(height));
        }
    }

    _drawSaddle(ctx, seg) {
        const { width, height, overlap, outerR, pipeOuterR } = seg;
        const steps = 60;

        ctx.fillStyle = (seg.color || '#2196f3') + '12';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(width - overlap, 0);
        for (let i = steps; i >= 0; i--) {
            const t = i / steps;
            const angle = t * Math.PI * 2;
            const saddleCut = pipeOuterR * (1 - Math.cos(Math.atan2(outerR * Math.sin(angle), pipeOuterR)));
            ctx.lineTo(t * (width - overlap), height - saddleCut);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const angle = t * Math.PI * 2;
            const saddleCut = pipeOuterR * (1 - Math.cos(Math.atan2(outerR * Math.sin(angle), pipeOuterR)));
            const px = t * (width - overlap);
            const py = height - saddleCut;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();

        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(width - overlap, 0); ctx.stroke();
        const firstSaddle = height - pipeOuterR * (1 - Math.cos(Math.atan2(outerR * 0, pipeOuterR)));
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, firstSaddle);
        ctx.moveTo(width - overlap, 0); ctx.lineTo(width - overlap, firstSaddle);
        ctx.stroke();

        if (this.options.showOverlap && overlap > 0) {
            ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';
            ctx.fillRect(width - overlap, 0, overlap, height);
        }
        if (this.options.showDimensions) {
            this._dimH(ctx, 0, height + 15, width, this._fmt(width));
        }
    }

    _drawCone(ctx, seg) {
        const { sectorR1, sectorR2, sectorAngle, overlap } = seg;
        const cx = sectorR1 + 20;
        const cy = sectorR1 + 20;
        const startAngle = -sectorAngle / 2;
        const endAngle = sectorAngle / 2;

        ctx.fillStyle = (seg.color || '#9c27b0') + '12';
        ctx.beginPath();
        ctx.arc(cx, cy, sectorR1, startAngle, endAngle);
        ctx.arc(cx, cy, sectorR2, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, sectorR1, startAngle, endAngle); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, sectorR2, startAngle, endAngle); ctx.stroke();
        for (const a of [startAngle, endAngle]) {
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * sectorR2, cy + Math.sin(a) * sectorR2);
            ctx.lineTo(cx + Math.cos(a) * sectorR1, cy + Math.sin(a) * sectorR1);
            ctx.stroke();
        }

        if (this.options.showOverlap && overlap > 0) {
            const overlapAngle = overlap / sectorR1;
            ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';
            ctx.beginPath();
            ctx.arc(cx, cy, sectorR1, endAngle, endAngle + overlapAngle);
            ctx.arc(cx, cy, sectorR2, endAngle + overlapAngle, endAngle, true);
            ctx.closePath();
            ctx.fill();
        }
        if (this.options.showFoldLines) {
            ctx.strokeStyle = '#2196f3';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([6, 3]);
            for (const q of [0.25, 0.5, 0.75]) {
                const a = startAngle + sectorAngle * q;
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * sectorR2, cy + Math.sin(a) * sectorR2);
                ctx.lineTo(cx + Math.cos(a) * sectorR1, cy + Math.sin(a) * sectorR1);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
        if (this.options.showDimensions) {
            ctx.fillStyle = '#333';
            ctx.font = '10px Segoe UI, sans-serif';
            ctx.fillText(`R1=${this._fmt(sectorR1)}`, cx + sectorR1 + 5, cy);
            ctx.fillText(`R2=${this._fmt(sectorR2)}`, cx + sectorR2 + 5, cy + 14);
            const angleDeg = Math.round((sectorAngle * 180) / Math.PI);
            ctx.fillText(`${angleDeg}\u00B0`, cx - 20, cy - sectorR1 - 5);
        }
    }

    _drawValveBox(ctx, seg) {
        const { width, height, overlap } = seg;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, 0, width, height);

        ctx.strokeStyle = (seg.color || '#f44336') + '20';
        ctx.lineWidth = 0.3;
        for (let d = 20; d < width + height; d += 20) {
            ctx.beginPath();
            ctx.moveTo(Math.max(0, d - height), Math.min(height, d));
            ctx.lineTo(Math.min(width, d), Math.max(0, d - width));
            ctx.stroke();
        }

        if (this.options.showFoldLines) {
            ctx.strokeStyle = '#2196f3';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([6, 3]);
            const qW = width / 4;
            for (let i = 1; i < 4; i++) {
                ctx.beginPath(); ctx.moveTo(qW * i, 0); ctx.lineTo(qW * i, height); ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        ctx.strokeStyle = '#d32f2f';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        const pipeHoleR = seg.diameter / 2 + seg.thickness;
        ctx.beginPath(); ctx.arc(0, height / 2, pipeHoleR, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(width, height / 2, pipeHoleR, Math.PI / 2, -Math.PI / 2); ctx.stroke();
        ctx.setLineDash([]);

        if (this.options.showOverlap && overlap > 0) {
            ctx.fillStyle = 'rgba(255, 152, 0, 0.15)';
            ctx.fillRect(width - overlap, 0, overlap, height);
        }
        if (this.options.showDimensions) {
            this._dimH(ctx, 0, height + 15, width, this._fmt(width));
            this._dimV(ctx, width + 15, 0, height, this._fmt(height));
        }
    }

    /* ===== DIMENSION HELPERS ===== */
    _dimH(ctx, x, y, w, label) {
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
        for (const [ax, dir] of [[x, 1], [x + w, -1]]) {
            ctx.beginPath();
            ctx.moveTo(ax, y);
            ctx.lineTo(ax + dir * 5, y - 3);
            ctx.lineTo(ax + dir * 5, y + 3);
            ctx.closePath();
            ctx.fillStyle = '#666';
            ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
        ctx.moveTo(x + w, y - 6); ctx.lineTo(x + w, y + 6);
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.font = '10px Segoe UI, sans-serif';
        ctx.fillText(label, x + w / 2 - ctx.measureText(label).width / 2, y - 4);
    }

    _dimV(ctx, x, y, h, label) {
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke();
        for (const [ay, dir] of [[y, 1], [y + h, -1]]) {
            ctx.beginPath();
            ctx.moveTo(x, ay);
            ctx.lineTo(x - 3, ay + dir * 5);
            ctx.lineTo(x + 3, ay + dir * 5);
            ctx.closePath();
            ctx.fillStyle = '#666';
            ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
        ctx.moveTo(x - 6, y + h); ctx.lineTo(x + 6, y + h);
        ctx.stroke();
        ctx.save();
        ctx.fillStyle = '#333';
        ctx.font = '10px Segoe UI, sans-serif';
        ctx.translate(x - 4, y + h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, -ctx.measureText(label).width / 2, 0);
        ctx.restore();
    }

    _fmt(val) {
        if (this.options.units === 'cm') return `${(val / 10).toFixed(1)} cm`;
        return `${Math.round(val)} mm`;
    }

    setFilter(visibleIds) {
        this.filterVisible = new Set(visibleIds);
    }

    getNestingStats() {
        const sheetW = this.options.sheetWidth;
        const sheetH = this.options.sheetHeight;
        const totalSheetArea = sheetW * sheetH * this.nestedSheets.length;
        let usedArea = 0, totalParts = 0;
        for (const sheet of this.nestedSheets) {
            usedArea += sheet.usedArea || 0;
            totalParts += sheet.items.length;
        }
        return {
            sheets: this.nestedSheets.length,
            totalParts, usedArea, totalSheetArea,
            efficiency: totalSheetArea > 0 ? Math.round((usedArea / totalSheetArea) * 100) : 0,
            wasteArea: totalSheetArea - usedArea
        };
    }

    /* ===== EXPORT ===== */
    exportSVG() {
        const sheetW = this.options.sheetWidth;
        const sheetH = this.options.sheetHeight;
        const sheets = this.nestedSheets.length || 1;
        const totalW = sheetW * sheets + this.PADDING * (sheets + 1);
        const totalH = sheetH + this.PADDING * 2 + 80;
        const gap = this.options.nestingGap;

        let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">\n`;
        svg += `<rect width="${totalW}" height="${totalH}" fill="white"/>\n`;
        svg += `<text x="${this.PADDING}" y="30" font-size="16" font-weight="bold" fill="#333">Thermatras - Geneste Isolatie-uitslagen</text>\n`;

        for (let si = 0; si < sheets; si++) {
            const sheet = this.nestedSheets[si];
            if (!sheet) continue;
            const ox = this.PADDING + si * (sheetW + this.PADDING);
            const oy = this.PADDING + 40;

            svg += `<rect x="${ox}" y="${oy}" width="${sheetW}" height="${sheetH}" fill="white" stroke="#333" stroke-width="2"/>\n`;
            svg += `<text x="${ox}" y="${oy - 8}" font-size="12" font-weight="bold" fill="#333">Plaat ${si + 1}</text>\n`;

            for (const item of sheet.items) {
                if (!this.filterVisible.has(item.pattern.componentId)) continue;
                const nested = item.seg._nested;
                if (!nested) continue;
                const px = ox + nested.x + gap / 2;
                const py = oy + nested.y + gap / 2;
                const color = item.seg.color || '#666';

                if (item.seg.subType === 'rect' || item.seg.subType === 'valve-box' || item.seg.subType === 't-main') {
                    const w = item.seg.width, h = item.seg.height;
                    const transform = nested.rotated ? `translate(${px + h},${py}) rotate(90)` : `translate(${px},${py})`;
                    svg += `<g transform="${transform}">`;
                    svg += `<rect x="0" y="0" width="${w}" height="${h}" fill="${color}15" stroke="${color}" stroke-width="1.5"/>`;
                    svg += `<text x="4" y="-4" font-size="9" font-weight="bold" fill="#333">${this._escHtml(item.seg.label)}</text>`;
                    svg += `</g>\n`;
                }
            }
        }
        svg += `</svg>`;
        this._download(svg, 'thermatras-uitslagen-genest.svg', 'image/svg+xml');
    }

    exportDXF() {
        const gap = this.options.nestingGap;
        const sheetW = this.options.sheetWidth;
        const sheetH = this.options.sheetHeight;
        let dxf = '0\nSECTION\n2\nENTITIES\n';

        for (let si = 0; si < this.nestedSheets.length; si++) {
            const sheet = this.nestedSheets[si];
            const sox = si * (sheetW + 100);
            const corners = [[0, 0], [sheetW, 0], [sheetW, sheetH], [0, sheetH], [0, 0]];
            for (let i = 0; i < corners.length - 1; i++) {
                dxf += `0\nLINE\n8\nSHEET\n`;
                dxf += `10\n${sox + corners[i][0]}\n20\n${corners[i][1]}\n30\n0\n`;
                dxf += `11\n${sox + corners[i + 1][0]}\n21\n${corners[i + 1][1]}\n31\n0\n`;
            }
            for (const item of sheet.items) {
                if (!this.filterVisible.has(item.pattern.componentId)) continue;
                const nested = item.seg._nested;
                if (!nested) continue;
                const ox = sox + nested.x + gap / 2;
                const oy = nested.y + gap / 2;

                if (item.seg.subType === 'rect' || item.seg.subType === 'valve-box' || item.seg.subType === 't-main') {
                    let rw = item.seg.width, rh = item.seg.height;
                    if (nested.rotated) { const tmp = rw; rw = rh; rh = tmp; }
                    const cs = [[0, 0], [rw, 0], [rw, rh], [0, rh], [0, 0]];
                    for (let i = 0; i < cs.length - 1; i++) {
                        dxf += `0\nLINE\n8\nCUT\n`;
                        dxf += `10\n${ox + cs[i][0]}\n20\n${oy + cs[i][1]}\n30\n0\n`;
                        dxf += `11\n${ox + cs[i + 1][0]}\n21\n${oy + cs[i + 1][1]}\n31\n0\n`;
                    }
                }
                if (item.seg.subType === 'gore' && item.seg.points) {
                    const pts = item.seg.points;
                    const maxY = Math.max(...pts.map(p => p.y));
                    for (let i = 0; i < pts.length - 1; i++) {
                        dxf += `0\nLINE\n8\nCUT\n`;
                        dxf += `10\n${ox + pts[i].x}\n20\n${oy + pts[i].y}\n30\n0\n`;
                        dxf += `11\n${ox + pts[i + 1].x}\n21\n${oy + pts[i + 1].y}\n31\n0\n`;
                    }
                    for (let i = 0; i < pts.length - 1; i++) {
                        dxf += `0\nLINE\n8\nCUT\n`;
                        dxf += `10\n${ox + pts[i].x}\n20\n${oy + maxY * 2 - pts[i].y}\n30\n0\n`;
                        dxf += `11\n${ox + pts[i + 1].x}\n21\n${oy + maxY * 2 - pts[i + 1].y}\n31\n0\n`;
                    }
                }
            }
        }
        dxf += '0\nENDSEC\n0\nEOF\n';
        this._download(dxf, 'thermatras-uitslagen-genest.dxf', 'application/dxf');
    }

    _escHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _download(data, filename, mimeType) {
        const blob = new Blob([data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    getSummary() {
        let totalParts = 0;
        const typeCount = {};
        for (const p of this.patterns) {
            if (this.filterVisible.has(p.componentId)) {
                totalParts += p.segments.length;
                typeCount[p.type] = (typeCount[p.type] || 0) + p.segments.length;
            }
        }
        return { totalParts, typeCount };
    }

    resetView() {
        this._panX = 0;
        this._panY = 0;
        this._zoom = 1;
        this.draw();
    }
}

window.UitslagGenerator = UitslagGenerator;
