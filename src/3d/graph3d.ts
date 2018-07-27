


import * as THREE from 'three'
import { SimpleScene } from './scene3d';
import { SlimGraph } from '../graph/tf_graph_common/graph';
import { Relaxer, EdgesCollection, NodesCollection, Point, Edge } from './relaxer';
import { Vector3 } from 'three';

export class Lib {
    public static lineColors = [
        1, 0.5, 0.5, 0, 0, 0.5
    ];


    public static materialStandard = new THREE.MeshStandardMaterial({
        color: 0xffcccc,
        metalness: 0.5,
        roughness: 0.8,
        side: THREE.FrontSide
    });

    public static lineMat = new THREE.LineBasicMaterial({ vertexColors: THREE.VertexColors, fog: true, linewidth: 3 });


    public static shiny = new THREE.MeshPhongMaterial({
        color: 0xcc00cc, specular: 0xffffff, shininess: 250,
        // wireframe: true,
        side: THREE.FrontSide, vertexColors: THREE.VertexColors
    });

    public static trans = new THREE.MeshPhongMaterial({
        color: 0x6666ff, specular: 0x6666ff, shininess: 100,
        // wireframe: true,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide, vertexColors: THREE.VertexColors
    });
}

export class ObjWrapper implements Point {
    obj: THREE.Object3D;
    vel: Vector3
    constructor(obj: THREE.Object3D) {
        this.obj = obj;
        this.vel = new Vector3();
    }
    get pos() {
        return this.obj.position;
    }

    set pos(p: Vector3) {
        this.obj.position.x = p.x;
        this.obj.position.y = p.y;
        this.obj.position.z = p.z;
    }
}


class EdgeWrapper implements Edge {
    a: ObjWrapper;
    b: ObjWrapper;
    line: THREE.Line;
    constructor(a: ObjWrapper, b: ObjWrapper) {
        this.a = a;
        this.b = b;
    }

}
const ARC_SEGMENTS = 2;
export class P3dScene extends SimpleScene implements EdgesCollection, NodesCollection {




    relaxer: Relaxer;
    private nodes: ObjWrapper[];
    private edges: EdgeWrapper[];
    constructor(container: HTMLElement) {
        super(container);
        this.relaxer = new Relaxer();
    }


    get listNodes() {
        return this.nodes;
    }

    get listEdges() {
        return this.edges;
    }

    public makeObjects() {
        //nothing to add.. a plane .. might be?
    }



    private names2mesh: { [nodeName: string]: ObjWrapper } = {};
    public rebuild(graph: SlimGraph) {


        this.names2mesh = {};
        this.nodes = [];
        //XXX: re-use object if any

        console.error("graph rebuild: " + graph.edges.length);

        this.resetScene();

        let names = Object.keys(graph.nodes);

        const R = Math.sqrt(graph.edges.length) + 2;
        const R2 = R / 2;

        for (let name of names) {
            let label = graph.nodes[name].nodeAttributes["label"];
            let spritey = this.makeTextSprite(label,
                { fontsize: 24, backgroundColor: { r: 255, g: 255, b: 255, a: 0.6 } });
            spritey.position.set(Math.random() * R - R2, Math.random() * R - R2, Math.random() * R - R2);
            this.scene.add(spritey);

            let ow = new ObjWrapper(spritey);
            this.names2mesh[name] = ow;
            this.nodes.push(ow);
        }

        this.edges = [];
        for (let edge of graph.edges) {
            let line = this.makeConnector(this.names2mesh[edge.v], this.names2mesh[edge.w]);
            this.scene.add(line);
            let ew = new EdgeWrapper(this.names2mesh[edge.v], this.names2mesh[edge.w]);
            ew.line = line;
            this.edges.push(ew);
        }
    }


    private updateMesh() {
        if (this.listNodes.length == 0) return;
        if (this.listEdges.length == 0) return;

        let min = this.listNodes[0].pos.clone();
        let max = this.listNodes[0].pos.clone();

        for (let e of this.listNodes) {
            min.x = Math.min(min.x, e.pos.x);
            min.y = Math.min(min.y, e.pos.y);
            min.z = Math.min(min.z, e.pos.z);

            max.x = Math.max(max.x, e.pos.x);
            max.y = Math.max(max.y, e.pos.y);
            max.z = Math.max(max.z, e.pos.z);
        }
        for (let e of this.edges) {
            let position: THREE.BufferAttribute = (e.line.geometry as THREE.BufferGeometry).attributes['position'] as THREE.BufferAttribute;

            position.setXYZ(0, e.a.pos.x, e.a.pos.y, e.a.pos.z);
            position.setXYZ(1, e.b.pos.x, e.b.pos.y, e.b.pos.z);
            position.needsUpdate = true;
        }


        let mid = min.clone().add(max).divideScalar(2);
        let size = max.clone().sub(min);

        {
            let controls: THREE.OrbitControls = this.controls;

            controls.target.x = mid.x;
            controls.target.y = mid.y;
            controls.target.y = mid.z;
            controls.maxDistance = size.length() * 1.2;

            let fov = (<THREE.PerspectiveCamera>this.camera).getEffectiveFOV();
            (this.scene.fog as any).far = fov * 0.8;//size.length();

            controls.update();
        }



    }




    private makeConnector(a: ObjWrapper, b: ObjWrapper): THREE.Line {


        let geometry = new THREE.BufferGeometry();

        let positions = [];

        positions.push(a.pos.x, a.pos.y, a.pos.z);
        positions.push(b.pos.x, b.pos.y, b.pos.z);

        geometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.addAttribute('color', new THREE.Float32BufferAttribute(Lib.lineColors, 3));

        geometry.computeBoundingSphere();

        var curveObject = new THREE.Line(geometry, Lib.lineMat);

        return curveObject;
    }



    private makeTextSprite(message, parameters): THREE.Sprite {
        if (parameters === undefined) parameters = {};

        const fontface = parameters.hasOwnProperty("fontface") ?
            parameters["fontface"] : "Roboto";

        const fontsize = parameters.hasOwnProperty("fontsize") ?
            parameters["fontsize"] : 18;



        const backgroundColor = parameters.hasOwnProperty("backgroundColor") ?
            parameters["backgroundColor"] : { r: 255, g: 255, b: 255, a: 1.0 };



        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 64;
        context.font = " " + fontsize + "px " + fontface;

        // get size data (height depends only on font size)
        let metrics = context.measureText(message);
        let textWidth = metrics.width;


        let fintScale = canvas.width / textWidth * 0.85;
        context.font = " " + fontsize * fintScale + "px " + fontface;

        metrics = context.measureText(message);
        textWidth = metrics.width;

        // background color
        context.fillStyle = "rgba(" + backgroundColor.r + "," + backgroundColor.g + ","
            + backgroundColor.b + "," + backgroundColor.a + ")";


        this.roundRect(context, 0, 0, canvas.width, fontsize * 1.4, 5);
        // 1.4 is extra height factor for text below baseline: g,j,p,q.

        // text color
        context.fillStyle = "rgba(0, 0, 0, 1.0)";
        context.fillText(message, (canvas.width - textWidth) / 2, fontsize);

        // canvas contents will be used for a texture
        const texture = new THREE.Texture(canvas)
        texture.needsUpdate = true;

        const spriteMaterial = new THREE.SpriteMaterial(
            {
                map: texture, lights: true, fog: true,


                side: THREE.FrontSide
            });
        const sprite = new THREE.Sprite(spriteMaterial);

        sprite.scale.set(2, 1, 1.0);


        return sprite;
    }


    private roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
        // ctx.stroke();
    }



    public render(): void {

        this.relaxer.relax(this, this);
        this.updateMesh();

        this.renderer.render(this.scene, this.camera);

    }

}
