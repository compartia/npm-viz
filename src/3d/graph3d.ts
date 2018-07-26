


import * as THREE from 'three'
import { SimpleScene } from './scene3d';
import { SlimGraph, BaseEdge } from '../graph/tf_graph_common/graph';
import { Relaxer, EdgesCollection, NodesCollection, Point, Edge } from './relaxer';
import { Vector3 } from 'three';

export class Lib {


    public static materialStandard = new THREE.MeshStandardMaterial({
        color: 0xffcccc,
        metalness: 0.5,
        roughness: 0.8,
        side: THREE.FrontSide
    });


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

        // let mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 0), Lib.materialStandard);
        // this.scene.add(mesh);
        let axis = new THREE.AxesHelper(10)
        this.scene.add(axis);

    }



    private names2mesh: { [nodeName: string]: ObjWrapper } = {};
    public rebuild(graph: SlimGraph) {
        const R = 16;
        const R2 = R / 2;

        this.names2mesh = {};
        this.nodes = [];
        //XXX: re-use object if any

        console.error("graph rebuild: " + graph.edges.length);

        this.resetScene();

        let names = Object.keys(graph.nodes);


        for (let name of names) {

            let spritey = this.makeTextSprite(name,
                { fontsize: 24, backgroundColor: { r: 255, g: 100, b: 100, a: 0.2 } });
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
        if (this.edges) {
            for (let e of this.edges) {
                let position: THREE.BufferAttribute = (e.line.geometry as THREE.BufferGeometry).attributes['position'] as THREE.BufferAttribute;

                position.setXYZ( 0, e.a.pos.x, e.a.pos.y, e.a.pos.z );
                position.setXYZ( 1, e.b.pos.x, e.b.pos.y, e.b.pos.z );
                position.needsUpdate = true;

                // e.line.geometry.ve
            }
        }
    }


    private __makeConnector(a: ObjWrapper, b: ObjWrapper): THREE.Line {

        let mid = a.pos.clone().add(b.pos).divideScalar(2);

        var curve = new THREE.CatmullRomCurve3([
            a.pos,
            mid,
            b.pos
        ]);

        var points = curve.getPoints(50);
        var geometry = new THREE.BufferGeometry().setFromPoints(points);

        var material = new THREE.LineBasicMaterial({ color: 0xff0000, fog: true });

        // Create the final object to add to the scene
        var curveObject = new THREE.Line(geometry, material);


        return curveObject;
    }

    private makeConnector(a: ObjWrapper, b: ObjWrapper): THREE.Line {

        // var geometry = new THREE.Geometry();
        // geometry.vertices.push(a.pos);
        // geometry.vertices.push(b.pos);
        // geometry.verticesNeedUpdate = true;


        // var points = new Array(6);
        //   a.pos.toArray(points)
        //   b.pos.toArray(points, 3);
        // var points =[a.pos, b.pos];
        let geometry = new THREE.BufferGeometry();//.setFromPoints(points);
        // geometry.addAttribute( 'position', new THREE.BufferAttribute( points, 3 ) );
        let mat = new THREE.LineBasicMaterial({ vertexColors: THREE.VertexColors, color: 0xff0000, fog: true });

        let positions = [];
        positions.push(a.pos.x, a.pos.y, a.pos.z);
        positions.push(b.pos.x, b.pos.y, b.pos.z);


        // geometry.addAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 3 ), 3 ) );
        geometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3));




        // geometry.attributes.position.setXYZ( 0, a.pos.x,  a.pos.y,  a.pos.z );
        // geometry.attributes.position.setXYZ( 1  , b.pos.x,  b.pos.y,  b.pos.z );
        // (geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;


        geometry.computeBoundingSphere();


        // var material = new THREE.LineBasicMaterial({ color: 0xff0000, fog: true });

        // Create the final object to add to the scene
        var curveObject = new THREE.Line(geometry, mat);


        return curveObject;
    }



    private makeTextSprite(message, parameters): THREE.Sprite {
        if (parameters === undefined) parameters = {};

        const fontface = parameters.hasOwnProperty("fontface") ?
            parameters["fontface"] : "Roboto";

        const fontsize = parameters.hasOwnProperty("fontsize") ?
            parameters["fontsize"] : 18;

        const borderThickness = parameters.hasOwnProperty("borderThickness") ?
            parameters["borderThickness"] : 4;

        const borderColor = parameters.hasOwnProperty("borderColor") ?
            parameters["borderColor"] : { r: 0, g: 0, b: 0, a: 1.0 };

        const backgroundColor = parameters.hasOwnProperty("backgroundColor") ?
            parameters["backgroundColor"] : { r: 255, g: 255, b: 255, a: 1.0 };

        // var spriteAlignment = THREE.SpriteAlignment.topLeft;

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
        // border color
        // context.strokeStyle = "rgba(" + borderColor.r + "," + borderColor.g + ","
        //     + borderColor.b + "," + borderColor.a + ")";

        // context.lineWidth = borderThickness;
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

        let timer = 0.002 * Date.now()

        // this.molecule.Ĥ();
        // this.molecule.update(1);

        this.updateMesh();


        // this.camera.position.x += 0.1;//2 + 0.5 * Math.sin(timer)
        // this.camera.position.y += 0.2;//2 + 0.5 * Math.sin(timer)
        // this.camera.position.z += 0.1 * Math.sin(timer / 10)

        this.camera.position.setLength(10);
        this.camera.lookAt(this.scene.position);



        this.renderer.render(this.scene, this.camera)
        // this.postprocessing.composer.render( 0.1 );

    }

}



// //----------------------
// const cs: ChemScene = new ChemScene(document.body);


// function step(timestamp) {
// 	cs.render();
// 	window.requestAnimationFrame(step);
// }

// window.requestAnimationFrame(step);