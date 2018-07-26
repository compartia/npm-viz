import * as T from 'three'


export abstract class SimpleScene {
    scene: T.Scene;
    renderer: T.WebGLRenderer;
    camera: T.Camera;

    container: HTMLElement;
    private light1: T.Light;

    private controls: Controls;
    postprocessing: any;

    constructor(container: HTMLElement) {
        this.container=container;
        this.scene = new T.Scene()

        let fogColor = new T.Color(0xcccccc);

        this.scene.background = fogColor;
        this.scene.fog = new T.Fog(fogColor.getHex(), 0.025, 30);



        let renderer = new T.WebGLRenderer()
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.gammaInput = true;
        renderer.gammaOutput = true;
        this.renderer = renderer;

        // set size
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // add canvas to dom
        container.appendChild(this.renderer.domElement);

        // add axis to the scene
        // let axis = new T.AxesHelper(10)
        // this.scene.add(axis);



        // this.initPostprocessing();
        // this.initControls(container);
        this.resetScene();
    }

    public resetScene() {

        while (this.scene.children.length > 0) {
            this.scene.remove(this.scene.children[0]);
        }

        this.makeLights();
        this.makeCamera();
        this.makeObjects();


    }


    private initControls(container: HTMLElement) {
        this.controls = new Controls();
        this.controls.mouseX = 0;
        this.controls.mouseY = 0;
        this.controls.windowHalfX = container.clientWidth / 2;
        this.controls.windowHalfY = container.clientHeight / 2;

        container.addEventListener('mousemove', () => this.onDocumentMouseMove, false);

    }

    private onDocumentMouseMove(event) {
        console.log("onDocumentMouseMove");
        this.controls.mouseX = (event.clientX - this.controls.windowHalfX) * 10;
        this.controls.mouseY = (event.clientY - this.controls.windowHalfY) * 10;
    }

    public abstract makeObjects();


    private makeLights() {
        // add lights
        {
            let light0 = new T.PointLight(0xff4444, 0.9)
            light0.position.set(0, 0, 0)
            this.scene.add(light0);

        }
        this.light1 = new T.DirectionalLight(0xee9955, 0.2)
        this.light1.position.set(100, 100, 100)
        this.scene.add(this.light1);

        let light2 = new T.DirectionalLight(0xffffff, 0.9)
        light2.position.set(-100, 100, -100)
        this.scene.add(light2)
    }

    private makeCamera() {
        // create the camera
        this.camera = new T.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        this.camera.position.x = 5
        this.camera.position.y = 5
        this.camera.position.z = 5

        this.camera.lookAt(this.scene.position);
        // this.camera.lookAt(<T.Vector3>{x:0,y:5,z:0});

    }


    public abstract render(): void;





}
class Controls {
    mouseY: number;
    mouseX: number;
    windowHalfX;
    windowHalfY;

}