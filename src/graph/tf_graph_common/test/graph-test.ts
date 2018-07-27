import { BuildParams, SlimGraph} from "../graph";
import * as util from "../util";
import * as testutil from "./util";
import * as parser from "../parser";
import * as graph from "../graph";
import { humanizeHealthPillStat } from "../scene";

/* Copyright 2015 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the 'License');
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an 'AS IS' BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
 

describe('graph', () => {
  let assert = chai.assert;

  it('graphlib exists', () => { assert.isTrue(graphlib != null); });

  it('simple graph contruction', done => {
    let pbtxt =  testutil.stringToArrayBuffer(`
      node {
        name: "Q"
        op: "Input"
      }
      node {
        name: "W"
        op: "Input"
      }
      node {
        name: "X"
        op: "MatMul"
        input: "Q:2"
        input: "W"
      }`);
     

    let buildParams:  BuildParams = {
      enableEmbedding: true,
      inEmbeddingTypes: ['Const'],
      outEmbeddingTypes: ['^[a-zA-Z]+Summary$'],
      refEdges: {}
    };
    let dummyTracker =
        util.getTracker({set: () => { return; }, progress: 0});
     parser.parseGraphPbTxt(pbtxt).then(nodes => {
       graph.build(nodes, buildParams, dummyTracker)
          .then((slimGraph: SlimGraph) => {
            assert.isTrue(slimGraph.nodes['X'] != null);
            assert.isTrue(slimGraph.nodes['W'] != null);
            assert.isTrue(slimGraph.nodes['Q'] != null);

            let firstInputOfX = slimGraph.nodes['X'].inputs[0];
            assert.equal(firstInputOfX.name, 'Q');
            assert.equal(firstInputOfX.outputTensorKey, '2');

            let secondInputOfX = slimGraph.nodes['X'].inputs[1];
            assert.equal(secondInputOfX.name, 'W');
            assert.equal(secondInputOfX.outputTensorKey, '0');
             
          });
    });
  }); 

  it('health pill numbers round correctly', () => {
    // Integers are rounded to the ones place.
    assert.equal(humanizeHealthPillStat(42.0, true), '42');

    // Numbers with magnitude >= 1 are rounded to the tenths place.
    assert.equal(humanizeHealthPillStat(1, false), '1.0');
    assert.equal(humanizeHealthPillStat(42.42, false), '42.4');
    assert.equal(humanizeHealthPillStat(-42.42, false), '-42.4');

    // Numbers with magnitude < 1 are written in scientific notation rounded to
    // the tenths place.
    assert.equal( humanizeHealthPillStat(0, false), '0.0e+0');
    assert.equal( humanizeHealthPillStat(0.42, false), '4.2e-1');
    assert.equal( humanizeHealthPillStat(-0.042, false), '-4.2e-2');
  });

  // TODO: write tests.
});

 