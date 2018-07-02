import * as _ from 'lodash';
import "polymer/polymer.html";

import { customElement, property } from 'taktik-polymer-typescript';

import { ProgressTracker } from '../tf_graph_common/common';
import * as Graph from '../tf_graph_common/graph';
import * as hierarchy from '../tf_graph_common/hierarchy';
import { GraphDef, NodeDef } from '../tf_graph_common/proto';
import * as util from '../tf_graph_common/util';
import './tf-graph-minimap';

import './tf-graph-loader.html';





@customElement('tf-graph-loader')
export class GraphScene extends Polymer.Element {


    /**
     * @type {{value: number, msg: string}}
     *
     * A number between 0 and 100 denoting the % of progress
     * for the progress bar and the displayed message.
     */
    @property({ type: Object, notify: true })
    progress: any;

    @property({ type: Array })
    datasets: Array<any>=['set 1'];

    @property({ type: Number })
    selectedDataset: number=0;

    @property({ type: Object })
    selectedFile: any
    /**
     * If this optional object is provided, graph logic will override
     * the HierarchyParams it uses to build the graph with properties within
     * this object. For possible properties that this object can have, please
     * see documentation on the HierarchyParams TypeScript interface.
     * @type {Object}
     */
    @property({ type: Object })
    overridingHierarchyParams: any = {};

    @property({ type: Object, notify: true, readOnly: true })
    outGraphHierarchy: any;

    @property({ type: Object, notify: true, readOnly: true })
    outGraph: Graph.SlimGraph;

    @property({ type: Object, notify: true, readOnly: true })
    outHierarchyParams: any;

    /** @type {Object} */
    @property({ type: Object, notify: true, readOnly: true })
    outStats: any;


    static get observers() {
        return [
            '_selectedDatasetChanged(selectedDataset, datasets, overridingHierarchyParams)',
            '_selectedFileChanged(selectedFile, overridingHierarchyParams)',
            '_readAndParseMetadata(selectedMetadataTag, overridingHierarchyParams)',
        ]
    };


    private _selectedDatasetChanged(datasetIndex, datasets, overridingHierarchyParams) {
      this._parseAndConstructHierarchicalGraph(
          datasets[datasetIndex].path, undefined, overridingHierarchyParams);
    };

    private loadGraphData(tracker: ProgressTracker): Promise<GraphDef> {
        return new Promise<GraphDef>(function (resolve, reject) {

            let g: GraphDef = {
                node: [],
                // Compatibility versions of the graph.
                versions: [],
                // Contains a library of functions that may composed through the graph.
                library: { function: [] }
            };

            for (let i = 0; i < 10; i++) {
                let n: NodeDef = <NodeDef>{
                    /** Name of the node */
                    name: 'string' + i,
                    /** List of nodes that are inputs for this node. */
                    input: [],
                    output: [],
                    /** The name of the device where the computation will run. */
                    device: 'string' + i,
                    /** The name of the operation associated with this node. */
                    op: 'OP',
                    /** List of attributes that describe/modify the operation. */
                    attr: {}//{ key: 'string'; value: 'any'; }[]; 
                }

                g.node.push(n);
            }


            resolve(g);


        });
    }

    private _parseAndConstructHierarchicalGraph(
        path, pbTxtFile, overridingHierarchyParams) {
        // Reset the progress bar to 0.
        this.set('progress', {
            value: 0,
            msg: ''
        });
        var tracker = util.getTracker(this);
        var hierarchyParams: hierarchy.HierarchyParams = {
            verifyTemplate: true,
            rankDirection: 'TB',
            // If a set of numbered op nodes has at least this number of nodes
            // then group them into a series node.
            seriesNodeMinSize: 5,
            // A map of series node names to series grouping settings, to indicate
            // if a series is to be rendered as grouped or ungrouped.
            // Starts out empty which allows the renderer to decide which series
            // are initially rendered grouped and which aren't.
            seriesMap: {},
            useGeneralizedSeriesPatterns: true,
        };

        _.forOwn(overridingHierarchyParams, (value, key) => {
            hierarchyParams[key] = value;
        });

        this.set('outHierarchyParams', hierarchyParams);

        var dataTracker = util.getSubtaskTracker(tracker, 30, 'Data');
        // tf.graph.parser.fetchAndParseGraphData(path, pbTxtFile, dataTracker)
        this.loadGraphData(dataTracker)
            .then((graph) => {
                if (!graph.node) {
                    throw 'The graph is empty. Make sure that the graph is passed to the ' +
                    'tf.summary.FileWriter after the graph is defined.';
                }

                // Build the flat graph (consists only of Op nodes).

                // This is the whitelist of inputs on op types that are considered
                // reference edges. "Assign 0" indicates that the first input to
                // an OpNode with operation type "Assign" is a reference edge.
                var refEdges = {};
                refEdges["Assign 0"] = true;
                refEdges["AssignAdd 0"] = true;
                refEdges["AssignSub 0"] = true;
                refEdges["assign 0"] = true;
                refEdges["assign_add 0"] = true;
                refEdges["assign_sub 0"] = true;
                refEdges["count_up_to 0"] = true;
                refEdges["ScatterAdd 0"] = true;
                refEdges["ScatterSub 0"] = true;
                refEdges["ScatterUpdate 0"] = true;
                refEdges["scatter_add 0"] = true;
                refEdges["scatter_sub 0"] = true;
                refEdges["scatter_update 0"] = true;
                var buildParams = {
                    enableEmbedding: true,
                    inEmbeddingTypes: ['Const'],
                    outEmbeddingTypes: ['^[a-zA-Z]+Summary$'],
                    refEdges: refEdges
                };
                var graphTracker = util.getSubtaskTracker(tracker, 20, 'Graph');
                return Graph.build(graph, buildParams, graphTracker);
            })
            .then(graph => {
                // Populate compatibile field of OpNode based on whitelist
                // Graph.op.checkOpsForCompatibility(graph);


                this.set('outGraph', graph);

                var hierarchyTracker = util.getSubtaskTracker(tracker, 50,
                    'Namespace hierarchy');
                return hierarchy.build(<Graph.SlimGraph>graph, hierarchyParams, hierarchyTracker);
            })
            .then((graphHierarchy) => {
                // Update the properties which notify the parent with the
                // graph hierarchy and whether the data has live stats or not.
                this.set('outGraphHierarchy', graphHierarchy);
            })
            .catch(function (e) {
                // Generic error catch, for errors that happened outside
                // asynchronous tasks.
                tracker.reportError("Graph visualization failed: " + e, e);
            });
    }

}