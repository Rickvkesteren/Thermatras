/**
 * PipeBuilder v3.5 - Enhanced 3D visualisatie engine voor complete installaties
 * Met verbindingsringen, betere materialen, verlichting, thermische kaart,
 * LiDAR scanstraal, camera fly-through en dimensie-annotaties
 */
class PipeBuilder {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.installationGroup = null;
        this.insulationGroup = null;
        this.pointCloudGroup = null;
        this.connectionsGroup = null;
        this.animationId = null;
        this.componentMeshes = new Map();
        this._thermalMode = false;
        this._dimensionGroup = null;
        this._scanBeamGroup = null;
        this._flyThroughId = null;
        this._originalMaterials = new Map();
        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e17);
        this.scene.fog = new THREE.FogExp2(0x0a0e17, 0.00012);

        const rect = this.container.getBoundingClientRect();
        this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 1, 50000);
        this.camera.position.set(1200, 800, 1500);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(rect.width, rect.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;

        // Enhanced 3-point lighting
        this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x222233, 0.5));
        const sun = new THREE.DirectionalLight(0xfff0dd, 0.9);
        sun.position.set(1000, 1500, 800);
        this.scene.add(sun);
        const fill = new THREE.DirectionalLight(0x4488cc, 0.35);
        fill.position.set(-600, 400, -800);
        this.scene.add(fill);
        const rim = new THREE.DirectionalLight(0xff8844, 0.2);
        rim.position.set(-200, -300, 600);
        this.scene.add(rim);

        // Floor grid
        const grid = new THREE.GridHelper(6000, 60, 0x2a3a5c, 0x151f35);
        grid.material.transparent = true;
        grid.material.opacity = 0.5;
        this.scene.add(grid);
        this.scene.add(new THREE.AxesHelper(400));

        // Ground shadow plane
        const groundGeo = new THREE.PlaneGeometry(6000, 6000);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.15 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -1;
        ground.receiveShadow = true;
        this.scene.add(ground);

        this.installationGroup = new THREE.Group();
        this.insulationGroup = new THREE.Group();
        this.pointCloudGroup = new THREE.Group();
        this.connectionsGroup = new THREE.Group();
        this.scene.add(this.installationGroup);
        this.scene.add(this.insulationGroup);
        this.scene.add(this.pointCloudGroup);
        this.scene.add(this.connectionsGroup);

        this._onResize = () => this.onResize();
        window.addEventListener('resize', this._onResize);
        this.animate();
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this.camera.aspect = rect.width / rect.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(rect.width, rect.height);
    }

    _clearGroup(group) {
        while (group.children.length > 0) {
            const c = group.children[0];
            c.traverse(sub => {
                if (sub.geometry) sub.geometry.dispose();
                if (sub.material) {
                    if (Array.isArray(sub.material)) sub.material.forEach(m => m.dispose());
                    else sub.material.dispose();
                }
            });
            group.remove(c);
        }
    }

    clearAll() {
        this._clearGroup(this.installationGroup);
        this._clearGroup(this.insulationGroup);
        this._clearGroup(this.pointCloudGroup);
        this._clearGroup(this.connectionsGroup);
        if (this._roomGroup) this._clearGroup(this._roomGroup);
        if (this._detectionGroup) this._clearGroup(this._detectionGroup);
        this.componentMeshes.clear();
    }

    // ========== BUILD FULL INSTALLATION ==========
    buildInstallation(components) {
        this._clearGroup(this.installationGroup);
        this._clearGroup(this.pointCloudGroup);
        this._clearGroup(this.connectionsGroup);
        this.componentMeshes.clear();

        for (const comp of components) {
            const group = new THREE.Group();
            group.userData.componentId = comp.id;
            this._buildComponentMesh(comp, group);
            this.installationGroup.add(group);
            this.componentMeshes.set(comp.id, { pipe: group });
        }

        // Weld/connection rings between components
        this._buildConnectionRings(components);
        this.fitCamera();
    }

    _buildConnectionRings(components) {
        const ringMat = new THREE.MeshStandardMaterial({
            color: 0xd0d0d0, metalness: 0.7, roughness: 0.2, emissive: 0x111111
        });

        for (let i = 0; i < components.length; i++) {
            const comp = components[i];
            const r = comp.diameter / 2;

            if (i === 0 && comp.type !== 'flange') {
                this._addRing(comp.startPos, comp.startDir, r, ringMat);
            }
            // Junction ring between adjacent non-flange components
            if (i < components.length - 1) {
                const next = components[i + 1];
                if (comp.type !== 'flange' && next.type !== 'flange') {
                    this._addRing(comp.endPos, comp.endDir, r, ringMat);
                }
            }
            if (i === components.length - 1 && comp.type !== 'flange') {
                this._addRing(comp.endPos, comp.endDir, r, ringMat);
            }
        }
    }

    _addRing(pos, dir, radius, mat) {
        const ringGeo = new THREE.TorusGeometry(radius * 1.02, Math.max(3, radius * 0.04), 12, 48);
        const ring = new THREE.Mesh(ringGeo, mat);
        ring.position.copy(pos);
        const torusN = new THREE.Vector3(0, 0, 1);
        const d = dir.clone().normalize();
        if (Math.abs(d.dot(torusN)) < 0.9999) {
            ring.quaternion.setFromUnitVectors(torusN, d);
        } else if (d.z < 0) {
            ring.rotation.x = Math.PI;
        }
        this.connectionsGroup.add(ring);
    }

    buildAllInsulation(components, insParams) {
        this._clearGroup(this.insulationGroup);
        for (const comp of components) {
            if (comp.type === 'flange') continue;
            const group = new THREE.Group();
            this._buildInsulationMesh(comp, insParams, group);
            this.insulationGroup.add(group);
        }
    }

    // ========== MATERIALS ==========
    _pipeMaterial(type) {
        const colors = {
            'straight': 0x6a8494, 'elbow': 0x7a9aaa, 'flange': 0xb0b0c0,
            't-piece': 0x6a8494, 'reducer': 0x809aa8, 'valve': 0x4a6070,
            'expansion-joint': 0x5a7888
        };
        return new THREE.MeshStandardMaterial({
            color: colors[type] || 0x708090,
            metalness: 0.4, roughness: 0.45, side: THREE.DoubleSide
        });
    }

    _insColor(material) {
        return { 'mineral-wool': 0xc4a747, 'glass-wool': 0xf5e642, 'foam': 0x42a5f5, 'aerogel': 0x90caf9, 'calcium-silicate': 0xbdbdbd }[material] || 0xc4a747;
    }

    _orient(mesh, center, dir) {
        const up = new THREE.Vector3(0, 1, 0);
        mesh.position.copy(center);
        if (Math.abs(dir.dot(up)) < 0.9999) {
            mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        } else if (dir.y < 0) {
            mesh.rotation.x = Math.PI;
        }
    }

    // ========== COMPONENT MESH BUILDERS ==========
    _buildComponentMesh(comp, group) {
        const r = comp.diameter / 2;
        const wt = comp.wallThickness || 6;
        const mat = this._pipeMaterial(comp.type);
        const dir = comp.startDir.clone().normalize();

        switch (comp.type) {
            case 'straight': {
                const center = comp.startPos.clone().add(dir.clone().multiplyScalar(comp.length / 2));
                const geo = new THREE.CylinderGeometry(r, r, comp.length, 32, 1, true);
                const mesh = new THREE.Mesh(geo, mat);
                this._orient(mesh, center, dir);
                group.add(mesh);
                for (const sign of [-1, 1]) {
                    const capGeo = new THREE.RingGeometry(r - wt, r, 32);
                    const cap = new THREE.Mesh(capGeo, mat.clone());
                    const capPos = comp.startPos.clone().add(dir.clone().multiplyScalar(sign === -1 ? 0 : comp.length));
                    this._orient(cap, capPos, sign === 1 ? dir : dir.clone().negate());
                    group.add(cap);
                }
                break;
            }
            case 'elbow': {
                const elbowAngle = (comp.bendAngle * Math.PI) / 180;
                const _ec = comp._center.clone();
                const _ek = comp._rotAxis.clone();
                const _esr = comp.startPos.clone().sub(comp._center);
                const _ea = elbowAngle;
                class ElbowCurve extends THREE.Curve {
                    constructor() { super(); }
                    getPoint(t) {
                        const a = t * _ea;
                        const cosA = Math.cos(a), sinA = Math.sin(a);
                        const kxv = new THREE.Vector3().crossVectors(_ek, _esr);
                        const kdv = _ek.dot(_esr);
                        return new THREE.Vector3(
                            _ec.x + _esr.x * cosA + kxv.x * sinA + _ek.x * kdv * (1 - cosA),
                            _ec.y + _esr.y * cosA + kxv.y * sinA + _ek.y * kdv * (1 - cosA),
                            _ec.z + _esr.z * cosA + kxv.z * sinA + _ek.z * kdv * (1 - cosA)
                        );
                    }
                }
                const segs = Math.max(48, Math.ceil(Math.abs(comp.bendAngle) / 2));
                const geo = new THREE.TubeGeometry(new ElbowCurve(), segs, r, 32, false);
                const mesh = new THREE.Mesh(geo, mat);
                group.add(mesh);
                // End caps for elbow
                for (const [pos, d] of [[comp.startPos, dir], [comp.endPos, comp.endDir]]) {
                    const capGeo = new THREE.RingGeometry(r - wt, r, 32);
                    const cap = new THREE.Mesh(capGeo, mat.clone());
                    this._orient(cap, pos, d);
                    group.add(cap);
                }
                break;
            }
            case 't-piece': {
                const center = comp.startPos.clone().add(dir.clone().multiplyScalar(comp.length / 2));
                const mainGeo = new THREE.CylinderGeometry(r, r, comp.length, 32, 1, true);
                const mainMesh = new THREE.Mesh(mainGeo, mat);
                this._orient(mainMesh, center, dir);
                group.add(mainMesh);

                const brR = r * 0.8;
                const brLen = comp.length * 0.5;
                const brDir = comp._branchDir || this._fallbackRight(dir);
                const brStart = comp._branchPos || center;
                const brCenter = brStart.clone().add(brDir.clone().multiplyScalar(brLen / 2));
                const brGeo = new THREE.CylinderGeometry(brR, brR, brLen, 32, 1, true);
                const brMesh = new THREE.Mesh(brGeo, mat);
                this._orient(brMesh, brCenter, brDir);
                group.add(brMesh);

                // Reinforcement saddle at junction
                const sGeo = new THREE.SphereGeometry(r * 1.08, 20, 20);
                const sMat = new THREE.MeshStandardMaterial({ color: 0x8a9aaa, metalness: 0.5, roughness: 0.3 });
                const sM = new THREE.Mesh(sGeo, sMat);
                sM.position.copy(brStart);
                group.add(sM);

                // Branch end cap
                const brEndPos = brStart.clone().add(brDir.clone().multiplyScalar(brLen));
                const brCapGeo = new THREE.RingGeometry(brR - wt * 0.8, brR, 32);
                const brCap = new THREE.Mesh(brCapGeo, mat.clone());
                this._orient(brCap, brEndPos, brDir);
                group.add(brCap);
                break;
            }
            case 'reducer': {
                const endR = (comp.endDiameter || comp.diameter * 0.7) / 2;
                const center = comp.startPos.clone().add(dir.clone().multiplyScalar(comp.length / 2));
                const geo = new THREE.CylinderGeometry(endR, r, comp.length, 32, 1, true);
                const mesh = new THREE.Mesh(geo, mat);
                this._orient(mesh, center, dir);
                group.add(mesh);
                for (const [sign, cr] of [[-1, r], [1, endR]]) {
                    const capGeo = new THREE.RingGeometry(cr - wt, cr, 32);
                    const cap = new THREE.Mesh(capGeo, mat.clone());
                    const capPos = comp.startPos.clone().add(dir.clone().multiplyScalar(sign === -1 ? 0 : comp.length));
                    this._orient(cap, capPos, sign === 1 ? dir : dir.clone().negate());
                    group.add(cap);
                }
                break;
            }
            case 'flange': {
                const fw = comp.flangeWidth || 30;
                const flangeR = r * 1.5;
                const center = comp.startPos.clone().add(dir.clone().multiplyScalar(fw / 2));
                const flMat = new THREE.MeshStandardMaterial({ color: 0xb0b0c0, metalness: 0.6, roughness: 0.3 });
                const geo = new THREE.CylinderGeometry(flangeR, flangeR, fw, 32);
                const mesh = new THREE.Mesh(geo, flMat);
                this._orient(mesh, center, dir);
                group.add(mesh);

                // Raised face on both sides
                const rfGeo = new THREE.CylinderGeometry(r * 1.15, r * 1.15, fw * 0.12, 32);
                const rfMat = new THREE.MeshStandardMaterial({ color: 0xc0c0d0, metalness: 0.5, roughness: 0.2 });
                for (const s of [-1, 1]) {
                    const rfPos = center.clone().add(dir.clone().multiplyScalar(s * fw * 0.46));
                    const rf = new THREE.Mesh(rfGeo, rfMat);
                    this._orient(rf, rfPos, dir);
                    group.add(rf);
                }

                // Bolts with hex nuts
                const boltCount = Math.max(4, Math.round(flangeR / 15) * 2);
                const boltCircleR = flangeR * 0.82;
                const boltR = Math.max(r * 0.06, 3);
                const boltMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 });
                const right = this._fallbackRight(dir);
                const upDir = new THREE.Vector3().crossVectors(right, dir).normalize();

                for (let i = 0; i < boltCount; i++) {
                    const angle = (i / boltCount) * Math.PI * 2;
                    const offset = right.clone().multiplyScalar(Math.cos(angle) * boltCircleR)
                        .add(upDir.clone().multiplyScalar(Math.sin(angle) * boltCircleR));
                    const bGeo = new THREE.CylinderGeometry(boltR, boltR, fw + 8, 8);
                    const bolt = new THREE.Mesh(bGeo, boltMat);
                    this._orient(bolt, center.clone().add(offset), dir);
                    group.add(bolt);
                    const nutGeo = new THREE.CylinderGeometry(boltR * 1.8, boltR * 1.8, 4, 6);
                    for (const ns of [-1, 1]) {
                        const nut = new THREE.Mesh(nutGeo, boltMat);
                        const nutPos = center.clone().add(offset).add(dir.clone().multiplyScalar(ns * (fw / 2 + 3)));
                        this._orient(nut, nutPos, dir);
                        group.add(nut);
                    }
                }
                break;
            }
            case 'valve': {
                const vLen = comp.valveLength || 200;
                const vMat = new THREE.MeshStandardMaterial({ color: 0x4a6070, metalness: 0.5, roughness: 0.4 });
                const center = comp.startPos.clone().add(dir.clone().multiplyScalar(vLen / 2));

                // Stub pipes
                for (const [start, end] of [[0, 0.2], [0.8, 1.0]]) {
                    const stubCenter = comp.startPos.clone().add(dir.clone().multiplyScalar(vLen * (start + end) / 2));
                    const sg = new THREE.CylinderGeometry(r, r, vLen * (end - start), 32, 1, true);
                    const sm = new THREE.Mesh(sg, vMat);
                    this._orient(sm, stubCenter, dir);
                    group.add(sm);
                }

                // Valve body
                const bodyGeo = new THREE.BoxGeometry(r * 2.3, vLen * 0.62, r * 2.3);
                const body = new THREE.Mesh(bodyGeo, vMat);
                this._orient(body, center, dir);
                group.add(body);

                // Integral flanges at body edges
                const flangeR = r * 1.3;
                const fgMat = new THREE.MeshStandardMaterial({ color: 0x808890, metalness: 0.5, roughness: 0.3 });
                for (const t of [0.19, 0.81]) {
                    const fPos = comp.startPos.clone().add(dir.clone().multiplyScalar(vLen * t));
                    const fGeo = new THREE.CylinderGeometry(flangeR, flangeR, 12, 32);
                    const fl = new THREE.Mesh(fGeo, fgMat);
                    this._orient(fl, fPos, dir);
                    group.add(fl);
                }

                // Bonnet + stem + handwheel
                const stemDir = this._fallbackRight(dir);
                const bonnetPos = center.clone().add(stemDir.clone().multiplyScalar(r * 1.4));
                const bonnetGeo = new THREE.CylinderGeometry(r * 0.35, r * 0.5, r * 1.0, 16);
                const bonnet = new THREE.Mesh(bonnetGeo, new THREE.MeshStandardMaterial({ color: 0x506878, metalness: 0.5, roughness: 0.35 }));
                this._orient(bonnet, bonnetPos, stemDir);
                group.add(bonnet);

                const stemPos = bonnetPos.clone().add(stemDir.clone().multiplyScalar(r * 0.9));
                const stemGeo = new THREE.CylinderGeometry(r * 0.06, r * 0.06, r * 1.4, 8);
                const stem = new THREE.Mesh(stemGeo, new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.2 }));
                this._orient(stem, stemPos, stemDir);
                group.add(stem);

                const wheelPos = bonnetPos.clone().add(stemDir.clone().multiplyScalar(r * 1.8));
                const wheelGeo = new THREE.TorusGeometry(r * 0.5, r * 0.06, 8, 24);
                const wheelMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, metalness: 0.3, roughness: 0.5 });
                const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                wheel.position.copy(wheelPos);
                const torusUp = new THREE.Vector3(0, 0, 1);
                const sd = stemDir.clone().normalize();
                if (Math.abs(sd.dot(torusUp)) < 0.9999) wheel.quaternion.setFromUnitVectors(torusUp, sd);
                group.add(wheel);

                // Wheel spokes
                const upV = new THREE.Vector3().crossVectors(stemDir, dir).normalize();
                for (let i = 0; i < 4; i++) {
                    const a = (i / 4) * Math.PI;
                    const spokeDir = dir.clone().multiplyScalar(Math.cos(a)).add(upV.clone().multiplyScalar(Math.sin(a))).normalize();
                    const spokeGeo = new THREE.CylinderGeometry(r * 0.025, r * 0.025, r * 0.95, 4);
                    const spoke = new THREE.Mesh(spokeGeo, wheelMat);
                    this._orient(spoke, wheelPos, spokeDir);
                    group.add(spoke);
                }
                break;
            }
            case 'expansion-joint': {
                const len = comp.length || 150;
                const ejMat = new THREE.MeshStandardMaterial({ color: 0x5a7888, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });

                // Entry/exit sleeves
                const sleeveLen = len * 0.15;
                for (const t of [0, 1]) {
                    const sStart = comp.startPos.clone().add(dir.clone().multiplyScalar(t === 0 ? 0 : len - sleeveLen));
                    const sCenter = sStart.clone().add(dir.clone().multiplyScalar(sleeveLen / 2));
                    const sGeo = new THREE.CylinderGeometry(r * 1.08, r * 1.08, sleeveLen, 32);
                    const sleeve = new THREE.Mesh(sGeo, ejMat);
                    this._orient(sleeve, sCenter, dir);
                    group.add(sleeve);
                }

                // Bellows corrugation
                const bellowStart = sleeveLen;
                const bellowLen = len - sleeveLen * 2;
                const bellowCount = 8;
                const bLen = bellowLen / bellowCount;
                for (let i = 0; i < bellowCount; i++) {
                    const bOdd = i % 2 === 0;
                    const bR = r * (bOdd ? 1.2 : 1.05);
                    const bRnext = r * (bOdd ? 1.05 : 1.2);
                    const pos = comp.startPos.clone().add(dir.clone().multiplyScalar(bellowStart + bLen * (i + 0.5)));
                    const bGeo = new THREE.CylinderGeometry(bRnext, bR, bLen * 0.95, 32, 1, true);
                    const bMesh = new THREE.Mesh(bGeo, ejMat);
                    this._orient(bMesh, pos, dir);
                    group.add(bMesh);
                }
                break;
            }
        }
    }

    // ========== INSULATION ==========
    _buildInsulationMesh(comp, insP, group) {
        const thick = insP.thickness;
        const r = comp.diameter / 2;
        const iR = r + thick;
        const insMat = new THREE.MeshStandardMaterial({
            color: this._insColor(insP.material),
            transparent: insP.transparent !== false,
            opacity: insP.transparent !== false ? 0.3 : 0.85,
            wireframe: insP.wireframe === true,
            side: THREE.DoubleSide,
            metalness: 0.0, roughness: 0.8
        });
        const dir = comp.startDir.clone().normalize();

        switch (comp.type) {
            case 'straight':
            case 'expansion-joint': {
                const nSeg = insP.numSegments || 2;
                const segLen = comp.length / nSeg;
                for (let i = 0; i < nSeg; i++) {
                    const pos = comp.startPos.clone().add(dir.clone().multiplyScalar(segLen * (i + 0.5)));
                    const geo = new THREE.CylinderGeometry(iR, iR, segLen - 3, 32, 1, true);
                    const mesh = new THREE.Mesh(geo, insMat);
                    this._orient(mesh, pos, dir);
                    group.add(mesh);
                }
                break;
            }
            case 'elbow': {
                const insAngle = (comp.bendAngle * Math.PI) / 180;
                const _ic = comp._center.clone();
                const _ik = comp._rotAxis.clone();
                const _isr = comp.startPos.clone().sub(comp._center);
                const _ia = insAngle;
                class InsElbowCurve extends THREE.Curve {
                    constructor() { super(); }
                    getPoint(t) {
                        const a = t * _ia;
                        const cosA = Math.cos(a), sinA = Math.sin(a);
                        const kxv = new THREE.Vector3().crossVectors(_ik, _isr);
                        const kdv = _ik.dot(_isr);
                        return new THREE.Vector3(
                            _ic.x + _isr.x * cosA + kxv.x * sinA + _ik.x * kdv * (1 - cosA),
                            _ic.y + _isr.y * cosA + kxv.y * sinA + _ik.y * kdv * (1 - cosA),
                            _ic.z + _isr.z * cosA + kxv.z * sinA + _ik.z * kdv * (1 - cosA)
                        );
                    }
                }
                const geo = new THREE.TubeGeometry(new InsElbowCurve(), 48, iR, 32, false);
                group.add(new THREE.Mesh(geo, insMat));
                break;
            }
            case 't-piece': {
                const center = comp.startPos.clone().add(dir.clone().multiplyScalar(comp.length / 2));
                const geo = new THREE.CylinderGeometry(iR, iR, comp.length, 32, 1, true);
                const mesh = new THREE.Mesh(geo, insMat);
                this._orient(mesh, center, dir);
                group.add(mesh);
                const brR = r * 0.8 + thick;
                const brLen = comp.length * 0.5;
                const brDir = comp._branchDir || this._fallbackRight(dir);
                const brPos = (comp._branchPos || center).clone().add(brDir.clone().multiplyScalar(brLen / 2));
                const brGeo = new THREE.CylinderGeometry(brR, brR, brLen, 32, 1, true);
                const brMesh = new THREE.Mesh(brGeo, insMat);
                this._orient(brMesh, brPos, brDir);
                group.add(brMesh);
                break;
            }
            case 'reducer': {
                const endR = (comp.endDiameter || comp.diameter * 0.7) / 2 + thick;
                const center = comp.startPos.clone().add(dir.clone().multiplyScalar(comp.length / 2));
                const geo = new THREE.CylinderGeometry(endR, iR, comp.length, 32, 1, true);
                const mesh = new THREE.Mesh(geo, insMat);
                this._orient(mesh, center, dir);
                group.add(mesh);
                break;
            }
            case 'valve': {
                const vLen = comp.valveLength || 200;
                const bR = iR * 1.3;
                const center = comp.startPos.clone().add(dir.clone().multiplyScalar(vLen / 2));
                const geo = new THREE.BoxGeometry(bR * 2, vLen, bR * 2);
                const mesh = new THREE.Mesh(geo, insMat);
                this._orient(mesh, center, dir);
                group.add(mesh);
                break;
            }
        }
    }

    // ========== HIGHLIGHT ==========
    highlightComponent(id) {
        this.componentMeshes.forEach((meshes) => {
            if (meshes.pipe) meshes.pipe.traverse(c => { if (c.material && c.material.emissive) c.material.emissive.setHex(0x000000); });
        });
        const entry = this.componentMeshes.get(id);
        if (entry && entry.pipe) entry.pipe.traverse(c => { if (c.material && c.material.emissive) c.material.emissive.setHex(0x332200); });
    }

    setInsulationTransparency(t) {
        this.insulationGroup.traverse(c => {
            if (c.material && c.material.transparent !== undefined) { c.material.transparent = t; c.material.opacity = t ? 0.3 : 0.85; c.material.needsUpdate = true; }
        });
    }

    setInsulationWireframe(w) {
        this.insulationGroup.traverse(c => { if (c.material) { c.material.wireframe = w; c.material.needsUpdate = true; } });
    }

    // ========== ROOM ENVIRONMENT ==========
    buildRoom(components) {
        if (!this._roomGroup) {
            this._roomGroup = new THREE.Group();
            this.scene.add(this._roomGroup);
        }
        this._clearGroup(this._roomGroup);

        // Compute room dimensions from pipe bounding box
        const box = new THREE.Box3();
        for (const c of components) {
            box.expandByPoint(c.startPos);
            box.expandByPoint(c.endPos);
        }
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const pad = 800;
        const rW = Math.max(size.x + pad * 2, 3000);
        const rH = Math.max(size.y + pad, 2800);
        const rD = Math.max(size.z + pad * 2, 3000);
        const floorY = box.min.y - 200;
        const cx = center.x, cz = center.z;

        const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a9098, metalness: 0.1, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.25 });
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x606868, metalness: 0.15, roughness: 0.9, side: THREE.DoubleSide });
        const concreteMat = new THREE.MeshStandardMaterial({ color: 0x707878, metalness: 0.1, roughness: 0.95 });

        // Floor
        const flG = new THREE.PlaneGeometry(rW, rD);
        const fl = new THREE.Mesh(flG, floorMat);
        fl.rotation.x = -Math.PI / 2;
        fl.position.set(cx, floorY, cz);
        this._roomGroup.add(fl);

        // Back wall
        const bwG = new THREE.PlaneGeometry(rW, rH);
        const bw = new THREE.Mesh(bwG, wallMat);
        bw.position.set(cx, floorY + rH / 2, cz - rD / 2);
        this._roomGroup.add(bw);

        // Left wall
        const lwG = new THREE.PlaneGeometry(rD, rH);
        const lw = new THREE.Mesh(lwG, wallMat);
        lw.rotation.y = Math.PI / 2;
        lw.position.set(cx - rW / 2, floorY + rH / 2, cz);
        this._roomGroup.add(lw);

        // Ceiling beams (I-beams)
        const beamMat = new THREE.MeshStandardMaterial({ color: 0x555e66, metalness: 0.6, roughness: 0.4 });
        const beamCount = Math.max(3, Math.round(rD / 800));
        for (let i = 0; i < beamCount; i++) {
            const bZ = cz - rD / 2 + (i + 0.5) * (rD / beamCount);
            // Web
            const webG = new THREE.BoxGeometry(rW * 0.9, 60, 8);
            const web = new THREE.Mesh(webG, beamMat);
            web.position.set(cx, floorY + rH - 40, bZ);
            this._roomGroup.add(web);
            // Flanges
            for (const fy of [-30, 30]) {
                const fG = new THREE.BoxGeometry(rW * 0.9, 8, 50);
                const f = new THREE.Mesh(fG, beamMat);
                f.position.set(cx, floorY + rH - 40 + fy, bZ);
                this._roomGroup.add(f);
            }
        }

        // Pipe supports / stanchions
        const stanchionMat = new THREE.MeshStandardMaterial({ color: 0x667070, metalness: 0.5, roughness: 0.5 });
        const stanchions = [
            new THREE.Vector3(box.min.x - 100, 0, center.z),
            new THREE.Vector3(box.max.x + 100, 0, center.z),
            new THREE.Vector3(center.x, 0, center.z)
        ];
        for (const sp of stanchions) {
            const legH = Math.max(center.y - floorY, 400);
            const legG = new THREE.CylinderGeometry(20, 25, legH, 8);
            const leg = new THREE.Mesh(legG, stanchionMat);
            leg.position.set(sp.x, floorY + legH / 2, sp.z);
            this._roomGroup.add(leg);
            // Cross arm
            const armG = new THREE.BoxGeometry(300, 15, 15);
            const arm = new THREE.Mesh(armG, stanchionMat);
            arm.position.set(sp.x, floorY + legH, sp.z);
            this._roomGroup.add(arm);
        }

        // Cable tray along one wall
        const trayMat = new THREE.MeshStandardMaterial({ color: 0x4a5050, metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide });
        const trayW = 120, trayH = 30;
        const trayG = new THREE.BoxGeometry(rW * 0.7, trayH, trayW);
        const tray = new THREE.Mesh(trayG, trayMat);
        tray.position.set(cx, floorY + rH * 0.75, cz - rD / 2 + 100);
        this._roomGroup.add(tray);

        this._roomBounds = { cx, cz, floorY, rW, rH, rD };
    }

    setRoomVisible(v) {
        if (this._roomGroup) this._roomGroup.visible = v;
    }

    // ========== ROOM + PIPE POINT CLOUD (LiDAR scan) ==========
    createRoomScanPointCloud(components, progress, phase) {
        this._clearGroup(this.pointCloudGroup);
        const pts = [], cols = [];
        const rb = this._roomBounds || { cx: 0, cz: 0, floorY: -200, rW: 3000, rH: 2800, rD: 3000 };

        // Phase 1 (0-0.4): Room structure scan
        if (phase === 'room' || progress < 0.4) {
            const roomPts = Math.floor(12000 * Math.min(progress / 0.4, 1));
            for (let i = 0; i < roomPts; i++) {
                let x, y, z;
                const surface = Math.random();
                if (surface < 0.35) { // Floor
                    x = rb.cx + (Math.random() - 0.5) * rb.rW;
                    y = rb.floorY + (Math.random() - 0.5) * 4;
                    z = rb.cz + (Math.random() - 0.5) * rb.rD;
                } else if (surface < 0.55) { // Back wall
                    x = rb.cx + (Math.random() - 0.5) * rb.rW;
                    y = rb.floorY + Math.random() * rb.rH;
                    z = rb.cz - rb.rD / 2 + (Math.random() - 0.5) * 4;
                } else if (surface < 0.75) { // Left wall
                    x = rb.cx - rb.rW / 2 + (Math.random() - 0.5) * 4;
                    y = rb.floorY + Math.random() * rb.rH;
                    z = rb.cz + (Math.random() - 0.5) * rb.rD;
                } else { // Ceiling beams
                    x = rb.cx + (Math.random() - 0.5) * rb.rW * 0.9;
                    y = rb.floorY + rb.rH - 40 + (Math.random() - 0.5) * 60;
                    z = rb.cz + (Math.random() - 0.5) * rb.rD;
                }
                // LiDAR sweep effect: only show points within scan angle
                const scanAngle = progress * Math.PI * 2.5;
                const angle = Math.atan2(z - rb.cz, x - rb.cx);
                if (Math.abs(((angle + Math.PI * 2) % (Math.PI * 2)) - (scanAngle % (Math.PI * 2))) < scanAngle * 0.4 + 0.5 || progress > 0.35) {
                    pts.push(x, y, z);
                    const n = (Math.random() * 0.3 + 0.35);
                    cols.push(n * 0.6, n * 0.7, n * 0.8); // Blueish for room
                }
            }
        }

        // Phase 2 (0.3-1.0): Pipe point cloud (overlaps with room)
        if (progress > 0.3) {
            const pipeProgress = Math.min((progress - 0.3) / 0.7, 1);
            const pipePts = Math.floor(18000 * pipeProgress);
            for (let i = 0; i < pipePts; i++) {
                const comp = components[Math.floor(Math.random() * components.length)];
                const rr = comp.diameter / 2;
                const angle = Math.random() * Math.PI * 2;
                const noise = (Math.random() - 0.5) * 4;
                const t = Math.random();

                let pos;
                if (comp.type === 'elbow' && comp._center && comp._rotAxis) {
                    const elbAngle = (comp.bendAngle * Math.PI) / 180;
                    const a = t * elbAngle;
                    const esr = comp.startPos.clone().sub(comp._center);
                    const ek = comp._rotAxis;
                    const cosA = Math.cos(a), sinA = Math.sin(a);
                    const kxv = new THREE.Vector3().crossVectors(ek, esr);
                    const kdv = ek.dot(esr);
                    pos = new THREE.Vector3(
                        comp._center.x + esr.x * cosA + kxv.x * sinA + ek.x * kdv * (1 - cosA),
                        comp._center.y + esr.y * cosA + kxv.y * sinA + ek.y * kdv * (1 - cosA),
                        comp._center.z + esr.z * cosA + kxv.z * sinA + ek.z * kdv * (1 - cosA)
                    );
                } else {
                    pos = comp.startPos.clone().lerp(comp.endPos, t);
                }

                const d = comp.endPos.clone().sub(comp.startPos);
                const dl = d.length();
                const dd = dl > 0.001 ? d.normalize() : new THREE.Vector3(0, 1, 0);
                const right = this._fallbackRight(dd);
                const upV = new THREE.Vector3().crossVectors(right, dd).normalize();
                const pr = rr + noise;
                pos.add(right.clone().multiplyScalar(Math.cos(angle) * pr));
                pos.add(upV.clone().multiplyScalar(Math.sin(angle) * pr));
                pts.push(pos.x, pos.y, pos.z);

                const intensity = 0.5 + Math.random() * 0.5;
                cols.push(intensity, 0.5 * intensity, 0.1 * intensity); // Warm for pipes
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        this.pointCloudGroup.add(new THREE.Points(geo, new THREE.PointsMaterial({
            size: 1.8, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true
        })));
    }

    // ========== AI DETECTION VISUALIZATION ==========
    showDetectionBoxes(components) {
        if (!this._detectionGroup) {
            this._detectionGroup = new THREE.Group();
            this.scene.add(this._detectionGroup);
        }
        this._clearGroup(this._detectionGroup);

        const colors = {
            'straight': 0x4caf50, 'elbow': 0xff9800, 't-piece': 0x2196f3,
            'reducer': 0x9c27b0, 'flange': 0x607d8b, 'valve': 0xf44336,
            'expansion-joint': 0x00bcd4
        };

        for (const comp of components) {
            const box = new THREE.Box3();
            box.expandByPoint(comp.startPos);
            box.expandByPoint(comp.endPos);
            // Expand by radius
            const r = comp.diameter / 2 + 30;
            box.expandByScalar(r);

            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            // Wireframe bounding box
            const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
            const edges = new THREE.EdgesGeometry(boxGeo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
                color: colors[comp.type] || 0x00ff00, linewidth: 2, transparent: true, opacity: 0.8
            }));
            line.position.copy(center);
            this._detectionGroup.add(line);

            // Label sprite
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, 0, 256, 64);
            ctx.strokeStyle = '#' + (colors[comp.type] || 0x00ff00).toString(16).padStart(6, '0');
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, 254, 62);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px Segoe UI';
            const typeLabels = {
                'straight': 'BUIS', 'elbow': 'BOCHT', 't-piece': 'T-STUK',
                'reducer': 'VERLOOP', 'flange': 'FLENS', 'valve': 'KLEP',
                'expansion-joint': 'COMP.'
            };
            ctx.fillText(typeLabels[comp.type] || comp.type, 8, 24);
            ctx.fillStyle = '#aaaaaa';
            ctx.font = '14px Segoe UI';
            ctx.fillText(`Ø${comp.diameter} ${comp.length ? 'L' + comp.length : ''}`, 8, 48);

            const tex = new THREE.CanvasTexture(canvas);
            const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.position.set(center.x, box.max.y + 60, center.z);
            sprite.scale.set(200, 50, 1);
            this._detectionGroup.add(sprite);
        }
    }

    showDetectionBoxesAnimated(components, count) {
        if (!this._detectionGroup) {
            this._detectionGroup = new THREE.Group();
            this.scene.add(this._detectionGroup);
        }
        this._clearGroup(this._detectionGroup);

        const colors = {
            'straight': 0x4caf50, 'elbow': 0xff9800, 't-piece': 0x2196f3,
            'reducer': 0x9c27b0, 'flange': 0x607d8b, 'valve': 0xf44336,
            'expansion-joint': 0x00bcd4
        };
        const typeLabels = {
            'straight': 'BUIS', 'elbow': 'BOCHT', 't-piece': 'T-STUK',
            'reducer': 'VERLOOP', 'flange': 'FLENS', 'valve': 'KLEP',
            'expansion-joint': 'COMP.'
        };

        const visible = components.slice(0, count);
        for (const comp of visible) {
            const box = new THREE.Box3();
            box.expandByPoint(comp.startPos);
            box.expandByPoint(comp.endPos);
            const r = comp.diameter / 2 + 30;
            box.expandByScalar(r);

            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
            const edges = new THREE.EdgesGeometry(boxGeo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
                color: colors[comp.type] || 0x00ff00, transparent: true, opacity: 0.8
            }));
            line.position.copy(center);
            this._detectionGroup.add(line);

            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, 0, 256, 64);
            ctx.strokeStyle = '#' + (colors[comp.type] || 0x00ff00).toString(16).padStart(6, '0');
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, 254, 62);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px Segoe UI';
            ctx.fillText(typeLabels[comp.type] || comp.type, 8, 24);
            ctx.fillStyle = '#aaaaaa';
            ctx.font = '14px Segoe UI';
            ctx.fillText(`Ø${comp.diameter} ${comp.length ? 'L' + comp.length : ''}`, 8, 48);

            const tex = new THREE.CanvasTexture(canvas);
            const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.position.set(center.x, box.max.y + 60, center.z);
            sprite.scale.set(200, 50, 1);
            this._detectionGroup.add(sprite);
        }
    }

    clearDetectionBoxes() {
        if (this._detectionGroup) this._clearGroup(this._detectionGroup);
    }

    // ========== CAMERA ==========
    fitCamera() {
        const box = new THREE.Box3();
        if (this.installationGroup.children.length > 0) box.setFromObject(this.installationGroup);
        if (this.insulationGroup.children.length > 0) box.expandByObject(this.insulationGroup);
        if (this.pointCloudGroup.children.length > 0) box.expandByObject(this.pointCloudGroup);
        if (this._roomGroup && this._roomGroup.children.length > 0) box.expandByObject(this._roomGroup);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = maxDim * 1.8;
        this.camera.position.set(center.x + dist * 0.5, center.y + dist * 0.5, center.z + dist * 0.7);
        this.controls.target.copy(center);
        this.controls.update();
    }

    _fallbackRight(dir) {
        const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        return new THREE.Vector3().crossVectors(dir, up).normalize();
    }

    // ========== THERMAL HEAT MAP ==========
    setThermalMode(enabled, components) {
        this._thermalMode = enabled;
        if (!enabled) {
            this._originalMaterials.forEach((matMap, compId) => {
                const entry = this.componentMeshes.get(compId);
                if (entry && entry.pipe) {
                    let idx = 0;
                    entry.pipe.traverse(c => {
                        if (c.material && matMap.has(idx)) {
                            c.material = matMap.get(idx);
                            c.material.needsUpdate = true;
                        }
                        idx++;
                    });
                }
            });
            this._originalMaterials.clear();
            return;
        }
        if (!components || components.length === 0) return;

        const total = components.length;
        for (let i = 0; i < total; i++) {
            const comp = components[i];
            const t = total > 1 ? i / (total - 1) : 0.5;
            const color = this._thermalColor(t);
            const thermalMat = new THREE.MeshStandardMaterial({
                color: color, metalness: 0.2, roughness: 0.6,
                emissive: color, emissiveIntensity: 0.15, side: THREE.DoubleSide
            });

            const entry = this.componentMeshes.get(comp.id);
            if (!entry || !entry.pipe) continue;

            const origMap = new Map();
            let idx = 0;
            entry.pipe.traverse(c => {
                if (c.material) {
                    origMap.set(idx, c.material);
                    c.material = thermalMat.clone();
                }
                idx++;
            });
            this._originalMaterials.set(comp.id, origMap);
        }
    }

    _thermalColor(t) {
        let r, g, b;
        if (t < 0.25) { r = 1; g = t * 4; b = 0; }
        else if (t < 0.5) { r = 1 - (t - 0.25) * 4; g = 1; b = 0; }
        else if (t < 0.75) { r = 0; g = 1; b = (t - 0.5) * 4; }
        else { r = 0; g = 1 - (t - 0.75) * 4; b = 1; }
        return new THREE.Color(r, g, b);
    }

    // ========== 3D DIMENSION ANNOTATIONS ==========
    showDimensions(components) {
        this.clearDimensions();
        if (!this._dimensionGroup) {
            this._dimensionGroup = new THREE.Group();
            this.scene.add(this._dimensionGroup);
        }

        for (const comp of components) {
            if (comp.type === 'flange') continue;
            const label = this._makeDimLabel(comp);
            if (label) this._dimensionGroup.add(label);

            if (comp.startPos && comp.endPos) {
                const geo = new THREE.BufferGeometry().setFromPoints([comp.startPos, comp.endPos]);
                const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
                    color: 0xffcc00, transparent: true, opacity: 0.5
                }));
                this._dimensionGroup.add(line);
            }
        }
    }

    _makeDimLabel(comp) {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, 0, 320, 48);
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 1;
        ctx.strokeRect(1, 1, 318, 46);
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 16px Segoe UI';

        let text = '\u00D8' + comp.diameter;
        if (comp.length) text += ' \u00D7 L' + comp.length;
        if (comp.type === 'elbow') text += ' ' + comp.bendAngle + '\u00B0';
        if (comp.type === 'reducer') text += ' \u2192 \u00D8' + (comp.endDiameter || Math.round(comp.diameter * 0.7));
        ctx.fillText(text, 8, 30);

        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);

        const mid = comp.startPos.clone().add(comp.endPos).multiplyScalar(0.5);
        sprite.position.set(mid.x, mid.y + comp.diameter + 80, mid.z);
        sprite.scale.set(180, 27, 1);
        return sprite;
    }

    clearDimensions() {
        if (this._dimensionGroup) this._clearGroup(this._dimensionGroup);
    }

    // ========== LIDAR SCAN BEAM ==========
    createScanBeam(progress) {
        if (!this._scanBeamGroup) {
            this._scanBeamGroup = new THREE.Group();
            this.scene.add(this._scanBeamGroup);
        }
        this._clearGroup(this._scanBeamGroup);
        if (!this._roomBounds) return;
        const rb = this._roomBounds;

        const scanAngle = progress * Math.PI * 6;
        const originY = rb.floorY + rb.rH * 0.3;

        const beamCount = 8;
        const pts = [];
        const beamColors = [];
        for (let i = 0; i < beamCount; i++) {
            const angle = scanAngle + (i / beamCount) * Math.PI * 2;
            const reach = rb.rW * 0.65;
            const ox = rb.cx + Math.cos(angle - 0.5) * 10;
            const oz = rb.cz + Math.sin(angle - 0.5) * 10;
            const ex = rb.cx + Math.cos(angle) * reach;
            const ez = rb.cz + Math.sin(angle) * reach;
            const ey = originY + Math.sin(progress * Math.PI * 12 + i) * rb.rH * 0.35;
            pts.push(ox, originY, oz, ex, ey, ez);
            beamColors.push(1, 0.1, 0.1, 0.8, 0.05, 0.05);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(beamColors, 3));
        this._scanBeamGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            vertexColors: true, transparent: true, opacity: 0.6
        })));

        // Origin glow
        const glowGeo = new THREE.SphereGeometry(15, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xff2200, transparent: true, opacity: 0.7 + Math.sin(progress * 40) * 0.3
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(rb.cx, originY, rb.cz);
        this._scanBeamGroup.add(glow);

        // Impact sparkles
        const sparkPts = [], sparkCols = [];
        for (let i = 0; i < beamCount; i++) {
            const angle = scanAngle + (i / beamCount) * Math.PI * 2;
            const ex = rb.cx + Math.cos(angle) * rb.rW * 0.65;
            const ez = rb.cz + Math.sin(angle) * rb.rW * 0.65;
            const ey = originY + Math.sin(progress * Math.PI * 12 + i) * rb.rH * 0.35;
            for (let s = 0; s < 5; s++) {
                sparkPts.push(ex + (Math.random() - 0.5) * 20, ey + (Math.random() - 0.5) * 20, ez + (Math.random() - 0.5) * 20);
                sparkCols.push(1, 0.5 + Math.random() * 0.5, 0.2);
            }
        }
        const sparkGeo = new THREE.BufferGeometry();
        sparkGeo.setAttribute('position', new THREE.Float32BufferAttribute(sparkPts, 3));
        sparkGeo.setAttribute('color', new THREE.Float32BufferAttribute(sparkCols, 3));
        this._scanBeamGroup.add(new THREE.Points(sparkGeo, new THREE.PointsMaterial({
            size: 4, vertexColors: true, transparent: true, opacity: 0.8, sizeAttenuation: true
        })));
    }

    clearScanBeam() {
        if (this._scanBeamGroup) this._clearGroup(this._scanBeamGroup);
    }

    // ========== CAMERA FLY-THROUGH ==========
    cameraFlyThrough(components, onComplete) {
        if (this._flyThroughId) {
            cancelAnimationFrame(this._flyThroughId);
            this._flyThroughId = null;
        }

        const pathPoints = [];
        for (const comp of components) pathPoints.push(comp.startPos.clone());
        if (components.length > 0) pathPoints.push(components[components.length - 1].endPos.clone());
        if (pathPoints.length < 2) { if (onComplete) onComplete(); return; }

        const box = new THREE.Box3();
        for (const p of pathPoints) box.expandByPoint(p);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const offset = Math.max(size.x, size.y, size.z) * 0.8;

        const camPath = pathPoints.map(p => {
            const dir = p.clone().sub(center).normalize();
            return p.clone().add(dir.clone().multiplyScalar(offset * 0.5)).add(new THREE.Vector3(0, offset * 0.4, 0));
        });

        const curve = new THREE.CatmullRomCurve3(camPath);
        const duration = 3000;
        const startTime = performance.now();

        const animate = (time) => {
            const elapsed = time - startTime;
            const t = Math.min(elapsed / duration, 1);
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

            if (t < 1) {
                const pos = curve.getPoint(eased);
                this.camera.position.copy(pos);
                const lookT = Math.min(eased + 0.05, 1);
                const lookAt = curve.getPoint(lookT);
                const target = center.clone().lerp(lookAt, 0.3);
                this.controls.target.copy(target);
                this.controls.update();
                this._flyThroughId = requestAnimationFrame(animate);
            } else {
                this._flyThroughId = null;
                this.fitCamera();
                if (onComplete) onComplete();
            }
        };
        this._flyThroughId = requestAnimationFrame(animate);
    }

    stopFlyThrough() {
        if (this._flyThroughId) {
            cancelAnimationFrame(this._flyThroughId);
            this._flyThroughId = null;
        }
    }

    // ========== SCREENSHOT ==========
    takeScreenshot() {
        this.renderer.render(this.scene, this.camera);
        const dataUrl = this.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'thermatras-3d-export.png';
        link.href = dataUrl;
        link.click();
    }

    dispose() {
        window.removeEventListener('resize', this._onResize);
        if (this.animationId) cancelAnimationFrame(this.animationId);
        if (this._flyThroughId) cancelAnimationFrame(this._flyThroughId);
        this.renderer.dispose();
    }
}

window.PipeBuilder = PipeBuilder;
