/**
 * InstallationBuilder - Beheert een keten van verbonden buiscomponenten
 * Elk component heeft een positie, oriëntatie en verbindingspunten
 */
class InstallationBuilder {
    constructor() {
        this.components = [];
        this.nextId = 1;
        // Current end-point, direction and normal for auto-chaining (frame propagation)
        this.cursor = { pos: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 0, 1) };
    }

    reset() {
        this.components = [];
        this.nextId = 1;
        this.cursor = { pos: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 0, 1) };
    }

    /**
     * Add a component to the end of the chain
     */
    addComponent(params) {
        const id = this.nextId++;
        const comp = {
            id,
            ...params,
            startPos: this.cursor.pos.clone(),
            startDir: this.cursor.dir.clone(),
            normal: this.cursor.normal.clone(),
            endPos: null,
            endDir: null,
            endNormal: null
        };

        // Compute end position/direction based on type
        this._computeEnd(comp);
        this.components.push(comp);

        // Advance cursor
        this.cursor.pos = comp.endPos.clone();
        this.cursor.dir = comp.endDir.clone();
        this.cursor.normal = comp.endNormal.clone();

        return comp;
    }

    removeComponent(id) {
        const idx = this.components.findIndex(c => c.id === id);
        if (idx === -1) return;
        this.components.splice(idx);
        // Re-chain from index
        this._rechainFrom(idx);
    }

    /**
     * Rebuild positions from index onwards
     */
    _rechainFrom(fromIndex) {
        if (fromIndex === 0) {
            this.cursor = { pos: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 0, 1) };
        } else {
            const prev = this.components[fromIndex - 1];
            this.cursor = { pos: prev.endPos.clone(), dir: prev.endDir.clone(), normal: prev.endNormal.clone() };
        }

        for (let i = fromIndex; i < this.components.length; i++) {
            const comp = this.components[i];
            comp.startPos = this.cursor.pos.clone();
            comp.startDir = this.cursor.dir.clone();
            comp.normal = this.cursor.normal.clone();
            this._computeEnd(comp);
            this.cursor.pos = comp.endPos.clone();
            this.cursor.dir = comp.endDir.clone();
            this.cursor.normal = comp.endNormal.clone();
        }
    }

    _computeEnd(comp) {
        const { startPos, startDir } = comp;
        const dir = startDir.clone().normalize();

        switch (comp.type) {
            case 'straight': {
                comp.endPos = startPos.clone().add(dir.clone().multiplyScalar(comp.length));
                comp.endDir = dir.clone();
                break;
            }
            case 'elbow': {
                const angleRad = (comp.bendAngle * Math.PI) / 180;
                const n = comp.normal.clone().normalize();
                // Frame-based bend axis:
                // vertical = bend in dir/normal plane (forward/back), axis = right
                // horizontal = bend in dir/right plane (left/right), axis = normal
                const right = new THREE.Vector3().crossVectors(dir, n).normalize();
                const rotAxis = comp.bendPlane === 'horizontal'
                    ? n.clone()
                    : right.clone();

                if (rotAxis.length() < 0.001) rotAxis.set(0, 0, 1);
                rotAxis.normalize();

                const newDir = dir.clone().applyAxisAngle(rotAxis, angleRad);
                const bendRadius = comp.bendRadius;

                // Center of bend arc
                const toCenter = new THREE.Vector3().crossVectors(rotAxis, dir).normalize().multiplyScalar(bendRadius);
                const center = startPos.clone().add(toCenter);
                // End position via Rodrigues rotation of start radius vector
                const startRad = startPos.clone().sub(center);
                const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
                const kxv = new THREE.Vector3().crossVectors(rotAxis, startRad);
                const kdv = rotAxis.dot(startRad);
                comp.endPos = new THREE.Vector3(
                    center.x + startRad.x * cosA + kxv.x * sinA + rotAxis.x * kdv * (1 - cosA),
                    center.y + startRad.y * cosA + kxv.y * sinA + rotAxis.y * kdv * (1 - cosA),
                    center.z + startRad.z * cosA + kxv.z * sinA + rotAxis.z * kdv * (1 - cosA)
                );
                comp.endDir = newDir.normalize();
                // Propagate normal through the bend
                comp.endNormal = n.clone().applyAxisAngle(rotAxis, angleRad);

                // Store for 3D rendering
                comp._rotAxis = rotAxis.clone();
                comp._center = center.clone();
                break;
            }
            case 't-piece': {
                // Main continues straight
                comp.endPos = startPos.clone().add(dir.clone().multiplyScalar(comp.length));
                comp.endDir = dir.clone();
                // Branch direction from frame (perpendicular in right direction)
                const branchDir = comp.normal
                    ? new THREE.Vector3().crossVectors(dir, comp.normal).normalize()
                    : this._getRight(dir);
                comp._branchDir = branchDir;
                comp._branchPos = startPos.clone().add(dir.clone().multiplyScalar(comp.length / 2));
                break;
            }
            case 'reducer': {
                comp.endPos = startPos.clone().add(dir.clone().multiplyScalar(comp.length));
                comp.endDir = dir.clone();
                break;
            }
            case 'flange': {
                comp.endPos = startPos.clone().add(dir.clone().multiplyScalar(comp.flangeWidth || 30));
                comp.endDir = dir.clone();
                break;
            }
            case 'valve': {
                const valveLen = comp.valveLength || 200;
                comp.endPos = startPos.clone().add(dir.clone().multiplyScalar(valveLen));
                comp.endDir = dir.clone();
                break;
            }
            case 'expansion-joint': {
                comp.endPos = startPos.clone().add(dir.clone().multiplyScalar(comp.length || 150));
                comp.endDir = dir.clone();
                break;
            }
            default: {
                comp.endPos = startPos.clone().add(dir.clone().multiplyScalar(comp.length || 100));
                comp.endDir = dir.clone();
            }
        }
        // Default normal propagation (elbows set endNormal explicitly above)
        if (!comp.endNormal) comp.endNormal = (comp.normal || new THREE.Vector3(0, 0, 1)).clone();
    }

    _getRight(dir) {
        const up = Math.abs(dir.y) > 0.99
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0, 1, 0);
        return new THREE.Vector3().crossVectors(dir, up).normalize();
    }

    _getUp(dir) {
        const right = this._getRight(dir);
        return new THREE.Vector3().crossVectors(right, dir).normalize();
    }

    /**
     * Get all components
     */
    getComponents() {
        return this.components;
    }

    /**
     * Stuklijst (bill of materials)
     */
    getBOM() {
        return this.components.map(c => {
            const typeLabels = {
                'straight': 'Rechte buis',
                'elbow': 'Bocht',
                't-piece': 'T-stuk',
                'reducer': 'Verloopstuk',
                'flange': 'Flens',
                'valve': 'Afsluiter',
                'expansion-joint': 'Compensator'
            };
            return {
                id: c.id,
                type: typeLabels[c.type] || c.type,
                diameter: c.diameter,
                length: c.length || c.flangeWidth || c.valveLength || '-',
                details: this._getDetails(c)
            };
        });
    }

    _getDetails(c) {
        const parts = [`Ø${c.diameter}`];
        if (c.type === 'elbow') parts.push(`${c.bendAngle}°`, `R${c.bendRadius}`);
        if (c.type === 'reducer') parts.push(`→ Ø${c.endDiameter}`);
        if (c.type === 'valve') parts.push(c.valveType || 'kogelkraan');
        if (c.length) parts.push(`L${c.length}`);
        return parts.join(' / ');
    }

    /**
     * Preset installations
     */
    static getPresets() {
        return {
            'stoomleiding': {
                name: 'Stoomleiding met bochten',
                description: 'Rechte buis → 90° bocht → rechte buis → 90° bocht → rechte buis',
                components: [
                    { type: 'flange', diameter: 219, wallThickness: 6, flangeWidth: 30 },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 800 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: 90, bendRadius: 300, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 600 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: 90, bendRadius: 300, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 500 },
                    { type: 'flange', diameter: 219, wallThickness: 6, flangeWidth: 30 }
                ]
            },
            'pompopstelling': {
                name: 'Pompopstelling',
                description: 'Reducer → rechte buis → afsluiter → rechte buis → bocht → rechte buis omhoog',
                components: [
                    { type: 'flange', diameter: 168, wallThickness: 5, flangeWidth: 25 },
                    { type: 'reducer', diameter: 168, wallThickness: 5, endDiameter: 219, length: 200 },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 400 },
                    { type: 'valve', diameter: 219, wallThickness: 6, valveLength: 250, valveType: 'kogelkraan' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 300 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: 90, bendRadius: 300, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 600 },
                    { type: 'flange', diameter: 219, wallThickness: 6, flangeWidth: 30 }
                ]
            },
            'warmtewisselaar': {
                name: 'Warmtewisselaar aansluiting',
                description: 'Complexe leidingconfiguratie met T-stuk, bochten en afsluiters',
                components: [
                    { type: 'flange', diameter: 273, wallThickness: 8, flangeWidth: 35 },
                    { type: 'straight', diameter: 273, wallThickness: 8, length: 500 },
                    { type: 'reducer', diameter: 273, wallThickness: 8, endDiameter: 219, length: 250 },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 300 },
                    { type: 'valve', diameter: 219, wallThickness: 6, valveLength: 250, valveType: 'vlinderkraan' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 200 },
                    { type: 't-piece', diameter: 219, wallThickness: 6, length: 400 },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 300 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: 90, bendRadius: 300, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 800 },
                    { type: 'flange', diameter: 219, wallThickness: 6, flangeWidth: 30 }
                ]
            },
            'ketelhuisroute': {
                name: 'Ketelhuis leidingroute',
                description: 'Uitgebreide route met meerdere bochten, verloopstukken en aftakkingen',
                components: [
                    { type: 'flange', diameter: 323, wallThickness: 10, flangeWidth: 40 },
                    { type: 'straight', diameter: 323, wallThickness: 10, length: 1000 },
                    { type: 'elbow', diameter: 323, wallThickness: 10, bendAngle: 45, bendRadius: 450, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 323, wallThickness: 10, length: 700 },
                    { type: 'elbow', diameter: 323, wallThickness: 10, bendAngle: 45, bendRadius: 450, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 323, wallThickness: 10, length: 500 },
                    { type: 'reducer', diameter: 323, wallThickness: 10, endDiameter: 219, length: 300 },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 600 },
                    { type: 't-piece', diameter: 219, wallThickness: 6, length: 400 },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 400 },
                    { type: 'valve', diameter: 219, wallThickness: 6, valveLength: 250, valveType: 'schuifafsluiter' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 300 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: 90, bendRadius: 300, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 1200 },
                    { type: 'flange', diameter: 219, wallThickness: 6, flangeWidth: 30 }
                ]
            },
            'u-bocht': {
                name: 'U-bocht compensatie',
                description: 'Rechte buis → 90° → rechte buis → 90° → rechte buis (U-vorm) voor thermische uitzetting',
                components: [
                    { type: 'flange', diameter: 168, wallThickness: 5, flangeWidth: 25 },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 600 },
                    { type: 'elbow', diameter: 168, wallThickness: 5, bendAngle: 90, bendRadius: 250, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 400 },
                    { type: 'elbow', diameter: 168, wallThickness: 5, bendAngle: 90, bendRadius: 250, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 600 },
                    { type: 'flange', diameter: 168, wallThickness: 5, flangeWidth: 25 }
                ]
            },
            'bypass': {
                name: 'Bypass leiding',
                description: 'Hoofdleiding met bypass via bochten en afsluiters',
                components: [
                    { type: 'flange', diameter: 219, wallThickness: 6, flangeWidth: 30 },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 300 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: 45, bendRadius: 300, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 500 },
                    { type: 'valve', diameter: 219, wallThickness: 6, valveLength: 250, valveType: 'kogelkraan' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 500 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: -45, bendRadius: 300, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 300 },
                    { type: 'flange', diameter: 219, wallThickness: 6, flangeWidth: 30 }
                ]
            },
            'procesinstallatie': {
                name: '3D Procesinstallatie',
                description: 'Complexe 3D-route met verticale en horizontale bochten, verloopstukken en afsluiters',
                components: [
                    { type: 'flange', diameter: 273, wallThickness: 8, flangeWidth: 35 },
                    { type: 'straight', diameter: 273, wallThickness: 8, length: 600 },
                    { type: 'elbow', diameter: 273, wallThickness: 8, bendAngle: 90, bendRadius: 400, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 273, wallThickness: 8, length: 800 },
                    { type: 'elbow', diameter: 273, wallThickness: 8, bendAngle: 90, bendRadius: 400, bendPlane: 'horizontal' },
                    { type: 'straight', diameter: 273, wallThickness: 8, length: 500 },
                    { type: 'reducer', diameter: 273, wallThickness: 8, endDiameter: 219, length: 250 },
                    { type: 'valve', diameter: 219, wallThickness: 6, valveLength: 250, valveType: 'vlinderkraan' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 400 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: -90, bendRadius: 300, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 600 },
                    { type: 'elbow', diameter: 219, wallThickness: 6, bendAngle: 90, bendRadius: 300, bendPlane: 'horizontal' },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 700 },
                    { type: 't-piece', diameter: 219, wallThickness: 6, length: 400 },
                    { type: 'straight', diameter: 219, wallThickness: 6, length: 500 },
                    { type: 'flange', diameter: 219, wallThickness: 6, flangeWidth: 30 }
                ]
            },
            'stoomverdeler': {
                name: 'Stoomverdeler (Manifold)',
                description: 'Distributie-manifold met meerdere T-stukken, afsluiters en verloopstukken',
                components: [
                    { type: 'flange', diameter: 323, wallThickness: 10, flangeWidth: 40 },
                    { type: 'straight', diameter: 323, wallThickness: 10, length: 400 },
                    { type: 'reducer', diameter: 323, wallThickness: 10, endDiameter: 273, length: 300 },
                    { type: 't-piece', diameter: 273, wallThickness: 8, length: 400 },
                    { type: 'straight', diameter: 273, wallThickness: 8, length: 300 },
                    { type: 'valve', diameter: 273, wallThickness: 8, valveLength: 280, valveType: 'schuifafsluiter' },
                    { type: 'straight', diameter: 273, wallThickness: 8, length: 250 },
                    { type: 't-piece', diameter: 273, wallThickness: 8, length: 400 },
                    { type: 'straight', diameter: 273, wallThickness: 8, length: 300 },
                    { type: 't-piece', diameter: 273, wallThickness: 8, length: 400 },
                    { type: 'straight', diameter: 273, wallThickness: 8, length: 200 },
                    { type: 'reducer', diameter: 273, wallThickness: 8, endDiameter: 168, length: 250 },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 400 },
                    { type: 'flange', diameter: 168, wallThickness: 5, flangeWidth: 25 }
                ]
            },
            'koelsysteem': {
                name: 'Koelsysteem lus',
                description: '3D koelwatercircuit met expansievat, bochten in alle richtingen en compensator',
                components: [
                    { type: 'flange', diameter: 168, wallThickness: 5, flangeWidth: 25 },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 500 },
                    { type: 'valve', diameter: 168, wallThickness: 5, valveLength: 200, valveType: 'kogelkraan' },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 300 },
                    { type: 'elbow', diameter: 168, wallThickness: 5, bendAngle: 90, bendRadius: 250, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 1000 },
                    { type: 'elbow', diameter: 168, wallThickness: 5, bendAngle: 90, bendRadius: 250, bendPlane: 'horizontal' },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 600 },
                    { type: 'expansion-joint', diameter: 168, wallThickness: 5, length: 200 },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 400 },
                    { type: 'elbow', diameter: 168, wallThickness: 5, bendAngle: 90, bendRadius: 250, bendPlane: 'vertical' },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 800 },
                    { type: 'elbow', diameter: 168, wallThickness: 5, bendAngle: 90, bendRadius: 250, bendPlane: 'horizontal' },
                    { type: 'straight', diameter: 168, wallThickness: 5, length: 500 },
                    { type: 'flange', diameter: 168, wallThickness: 5, flangeWidth: 25 }
                ]
            }
        };
    }
}

window.InstallationBuilder = InstallationBuilder;
