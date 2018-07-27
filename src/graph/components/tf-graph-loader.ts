import * as _ from 'lodash';
import "polymer/polymer.html";

import { customElement, property } from 'taktik-polymer-typescript';

import { ProgressTracker } from '../tf_graph_common/common';
import * as GraphModule from '../tf_graph_common/graph';
import { SlimGraph } from '../tf_graph_common/graph';
import * as hierarchy from '../tf_graph_common/hierarchy';
import { GraphDef, NodeDef } from '../tf_graph_common/proto';
import * as util from '../tf_graph_common/util';
import './tf-graph-minimap';

import './tf-graph-loader.html';
import { json } from 'd3';
import { PackageLockGraph } from '../npmjson';





@customElement('tf-graph-loader')
export class GraphScene extends Polymer.Element {
    
    @property({ type: String })
    packageLockUrl:string;

    /**
     * @type {{value: number, msg: string}}
     *
     * A number between 0 and 100 denoting the % of progress
     * for the progress bar and the displayed message.
     */
    @property({ type: Object, notify: true })
    progress: any;

    @property({ type: Array })
    datasets: Array<any> = ['set 1'];

    @property({ type: Number })
    selectedDataset: number = 0;

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
    outGraphHierarchy: hierarchy.Hierarchy = null;

    @property({ type: Object, notify: true, readOnly: true })
    outGraph: GraphModule.SlimGraph;

    @property({ type: Object, notify: true, readOnly: true })
    outHierarchyParams: any;

    @property({ type: Object, notify: true})
    jsonLoaded: any;

    /** @type {Object} */
    @property({ type: Object, notify: true, readOnly: true })
    outStats: any;


    static get observers() {
        return [
            '_selectedDatasetChanged(jsonLoaded, overridingHierarchyParams)'
        ]
    };


    private _selectedDatasetChanged(jsonLoaded, overridingHierarchyParams) {
        this._parseAndConstructHierarchicalGraph(jsonLoaded, overridingHierarchyParams);
    };


    private loadGraphData(json:any, tracker: ProgressTracker): Promise<GraphDef> {
         
        if(!json){
            return Promise.resolve(<GraphDef>{node: []});
        }
    

        return new Promise<GraphDef>(function (resolve, reject) {

            let plg= new PackageLockGraph(json);
            
             
            tracker.updateProgress(100);
            resolve(plg);

        });
    }

    public onFileLoaded(file:any){
        console.log(file);
    }

    private _parseAndConstructHierarchicalGraph(jsonLoaded, overridingHierarchyParams) {
        
        // Reset the progress bar to 0.
        this.set('progress', {
            value: 0,
            msg: '_parseAndConstructHierarchicalGraph', 
            name:"n1"
        });

        const _tracker = util.getTracker(this);
        
        
        var hierarchyParams: hierarchy.HierarchyParams = {
            verifyTemplate: true,
            rankDirection: 'LR',
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

        const _dataTracker = util.getSubtaskTracker(_tracker, 30, 'Data');
        // tf.graph.parser.fetchAndParseGraphData(path, pbTxtFile, dataTracker)
        this.loadGraphData(jsonLoaded, _dataTracker)
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
               
                var buildParams = {
                    enableEmbedding: true,
                    inEmbeddingTypes: ['Const'],
                    outEmbeddingTypes: ['^[a-zA-Z]+Summary$'],
                    refEdges: refEdges
                };
                const _graphTracker = util.getSubtaskTracker(_tracker, 20, 'Graph');
                return GraphModule.build(graph, buildParams, _graphTracker);
            })
            .then((graph: SlimGraph) => {
                console.log("graph=" + graph);
                // Populate compatibile field of OpNode based on whitelist
 
                (this as any)._setOutGraph(graph);

                const _hierarchyTracker = util.getSubtaskTracker(_tracker, 50, 'Namespace hierarchy');
                return hierarchy.build(<SlimGraph>graph, hierarchyParams, _hierarchyTracker);
            })
            .then((graphHierarchy: hierarchy.Hierarchy) => {
                console.log("hierarchy=" + graphHierarchy);
                // Update the properties which notify the parent with the
                // graph hierarchy and whether the data has live stats or not.
                (this as any)._setOutGraphHierarchy(graphHierarchy);
                console.log("outGraph=" + this.outGraph);
                console.log("outGraphHierarchy=" + this.outGraphHierarchy);

            })
            .catch(function (e) {
                console.error(e);
                // Generic error catch, for errors that happened outside
                // asynchronous tasks.
                _tracker.reportError("Graph visualization failed: " + e, e);
            });
    };



     

}