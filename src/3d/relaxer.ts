export interface Point {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
}

export interface Edge {
    a: Point;
    b: Point;
}

export interface EdgesCollection {
    listEdges: Edge[];
}

export interface NodesCollection {
    listNodes: Point[];
}

export class Relaxer {
    public relax(edges: EdgesCollection, nodes: NodesCollection) {
        let speed = 1;
        // repulsion
        for (let n1 of nodes.listNodes) {
            for (let n2 of nodes.listNodes) {
                this.repulse(n1, n2, speed / 30);
            }
        }

        // attraction
        for (let e of edges.listEdges) {
            this.e2eInteract(e.a, e.b, -speed * 1);
        }

        for (let n of nodes.listNodes) {
            let newPos = n.pos.clone().add(n.vel);
            n.pos = newPos;
            if (n.vel.length() > 0.1) n.vel.setLength(0.1);
            n.vel.multiplyScalar(0.9);
        }

    }
    public repulse(e: Point, n: Point, k: number) {
        const MAX_LEN = 10;
        const MAX_LEN_SQ = MAX_LEN * MAX_LEN;
        const eps = MAX_LEN_SQ / 10;

        if (e === n) return;

        let rSquared = e.pos.distanceToSquared(n.pos);
        if (rSquared > MAX_LEN_SQ) return;

        let attractionMagnitude = k / rSquared;

        let f = e.pos.clone().sub(n.pos);
        f = f.normalize().multiplyScalar(attractionMagnitude);

        // let force1 = f.clone();//.divideScalar(e.mass);
        // let force2 = f.clone();//.divideScalar(n.mass);


        e.vel.add(f);
        n.vel.sub(f);

    }

    public e2eInteract(e: Point, n: Point, k: number) {
        const MAX_LEN = 2;
        const MAX_LEN_SQ = MAX_LEN * MAX_LEN;
        const eps = MAX_LEN_SQ / 10;

        //k==1/2 for el-el an nuk-nuk because of symmetry
        if (e === n) return;

        let rSquared = e.pos.distanceTo(n.pos) - MAX_LEN;
        // if (rSquared < MAX_LEN) return;

        let attractionMagnitude = 0.02 * k * rSquared;

        let f = e.pos.clone().sub(n.pos);
        f = f.normalize().multiplyScalar(attractionMagnitude);

        // let force1 = f.clone();//.divideScalar(e.mass);
        // let force2 = f.clone();//.divideScalar(n.mass);


        e.vel.add(f);
        n.vel.sub(f);

    }

}
