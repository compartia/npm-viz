/// <reference path="externs.d.ts"/>
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
/**
 * Package for the Render Hierarchy for TensorFlow graph.
 */
import * as graphlib from 'graphlib';
import * as d3 from 'd3';
import * as _ from 'lodash';
import { EdgeData } from './annotation';
import * as edge from './edge';
import * as graph from './graph';
import { createGraph, EllipsisNode, getHierarchicalPath, GraphType, GroupNode, InclusionType, Metaedge, Metanode, Node, NodeType, OpNode } from './graph';
import * as hierarchy from './hierarchy';
import { NodeDef } from './proto';


const UNKNOWN="___unknown___";
export type Point = {x: number, y: number};

/**
 * Color parameters for op nodes.
 */
export let OpNodeColors = {DEFAULT_FILL: '#ffffff', DEFAULT_STROKE: '#b2b2b2',
                           COMPATIBLE: '#0f9d58', INCOMPATIBLE: '#db4437'};

/**
 * Color parameters for node encoding.
 * @type {Object}
 */
export let MetanodeColors = {
  /**
   * Default fill and stroke to use when no other information is available.
   */
  DEFAULT_FILL: '#d9d9d9',
  DEFAULT_STROKE: '#a6a6a6',
  SATURATION: 0.6,
  LIGHTNESS: 0.85,
  /**
   * Neutral color to use when the node is expanded (used when coloring by
   * compute time, memory and device).
   */
  EXPANDED_COLOR: '#f0f0f0',
  /**
   * Standard hue values for node color palette.
   */
  HUES: [220, 100, 180, 40, 20, 340, 260, 300, 140, 60],
  STRUCTURE_PALETTE(id: number, lightened?: boolean) {
    // The code below is a flexible way to computationally create a set
    // of colors that go well together.
    let hues = MetanodeColors.HUES;
    let n = hues.length;
    let hue = hues[id % n];
    let m = Math.sin(hue * Math.PI / 360);
    let sat = lightened ? 30 : 90 - 60 * m;
    let light = lightened ? 95 : 80;
    return d3.hsl(hue, .01 * sat, .01 * light).toString();
  },
  DEVICE_PALETTE(index: number): string {
    return MetanodeColors.STRUCTURE_PALETTE(index);
  },
  XLA_CLUSTER_PALETTE(index: number): string {
    return MetanodeColors.STRUCTURE_PALETTE(index);
  },
  UNKNOWN: '#eee',
  GRADIENT_OUTLINE: '#888'
};

/**
 * Color parameters for op nodes.
 */
export let SeriesNodeColors = {
  DEFAULT_FILL: 'white',
  DEFAULT_STROKE: '#b2b2b2'
};


/**
 * Function that computes edge thickness in pixels.
 */
export interface EdgeThicknessFunction {
  (edgeData: EdgeData, edgeClass: string): number;
}

/**
 * Function that computes edge label strings. This function accepts a Metaedge,
 * which could actually encapsulate several base edges. For instance, several
 * base edges may merge into a single metaedge.
 *
 * To determine whether a metaedge represents several edges, check the length of
 * its baseEdgeList property.
 */
export interface EdgeLabelFunction {
  (metaedge: Metaedge, renderInfo: RenderGraphInfo): string;
}

/**
 * Parameters that affect how the graph is rendered on the screen.
 */
const PARAMS = {
  /**
   * Whether to extract high degree nodes from the core part of the graph.
   */
  enableExtraction: false,
  /**
   * The minimum number of nodes for a graph to have in order for high in and
   * out degree nodes to be extracted in auxiliary. The aim here is to prevent
   * nodes from being extracted from small graphs.
   */
  minNodeCountForExtraction: 15,
  /**
   * The minimum in or out degree a node must have in order to be possibly
   * extracted.
   */
  minDegreeForExtraction: 40,
  /**
   * Maximum number of control edges a node can have before they aren't
   * displayed.
   */
  maxControlDegree: 4,
  /**
   * Maximum in (for outbound bridge paths) or out (for inbound bridge paths)
   * degree of a node allowed for a bridge path to be rendered to it from a
   * subhierarchy of nodes. Having a max prevents having too many nodes emanate
   * from a subhierarchy and crowding up.
   */
  maxBridgePathDegree: 4,
  /**
   * Types patterns for predefined out-extract nodes, which are
   * sink-like nodes that will be extracted from the main graph.
   */
  outExtractTypes: [
    'NoOp'  // NoOps are sink-like used for managing control dependencies.
  ],

  /**
   * Types patterns for predefined in-extract nodes, which are
   * source-like nodes that will be extracted from the main graph.
   */
  inExtractTypes: [],

  /**
   * When removing edges from a high degree node, remove all of its edges if
   * detachAllEdgesForHighDegree is true.  Otherwise remove all in-edges if
   * the node has high in-degree, or all out-edges if the node has high
   * out-degree.
   */
  detachAllEdgesForHighDegree: true,

  /**
   * After extracting high in/out degree nodes and predefined
   * source-like/sink-like, extract isolated nodes to the side
   * if this extractIsolatedNodesWithAnnotationsOnOneSide is true.
   */
  extractIsolatedNodesWithAnnotationsOnOneSide: true,

  /**
   * Whether to add bridge nodes and edges to the core when building the
   * subhierarchy of an expanded metanode. See buildSubhierarchy().
   */
  enableBridgegraph: false,

  /**
   * 2 colors, for the minimum and maximum value respectively, whenever we
   * have a gradient scale.
   */
  minMaxColors: ['#fff5f0', '#fb4a6a'],

  /**
   * Maximum number of annotations to be displayed on a node before an
   * ellipsis is used.
   */
  maxAnnotations: 5
};

/**
 * The regular expression to use when parsing for the string that is
 * used to label a function node in the graph. We strip away a prefix
 * indicating that the node represents a function definition. We also
 * remove an arbitrary hexadecimal suffix and the number following it
 * if it is present. To be clear, we extract foo from
 * __function_library__foo_deadb00f_42.
 */
const nodeDisplayNameRegex = new RegExp(
    '^(?:' + '__SOME__' +
        ')?(\\w+)_[a-z0-9]{8}(?:_\\d+)?$');

/**
 * Stores the rendering information, such as x and y coordinates,
 * for each node in the graph.
 */
export class RenderGraphInfo {
  hierarchy: hierarchy.Hierarchy;
  private displayingStats: boolean;
  private index: {[nodeName: string]: RenderNodeInfo};
  renderedOpNames: string[];
  deviceColorMap?: d3.ScaleOrdinal<string, string>;
   
  cardinalityScale?: d3.ScaleLinear<string, string>;
  computeTimeScale?: d3.ScaleLinear<string, string>;
  /** Scale for the thickness of edges when there is no shape information. */
  edgeWidthSizedBasedScale?:
      d3.ScaleLinear<number, number> | d3.ScalePower<number, number>;
  // Since the rendering information for each node is constructed lazily,
  // upon node's expansion by the user, we keep a map between the node's name
  // and whether the rendering information was already constructed for that
  // node.
  private hasSubhierarchy: {[nodeName: string]: boolean};
  root: RenderGroupNodeInfo;
  traceInputs: Boolean;
  edgeLabelFunction?: EdgeLabelFunction;
  // An optional function that computes the thickness of an edge given edge
  // data. If not provided, defaults to encoding tensor size in thickness.
  edgeWidthFunction?: EdgeThicknessFunction;

  constructor(hierarchy: hierarchy.Hierarchy, displayingStats: boolean) {
    this.hierarchy = hierarchy;
    this.displayingStats = displayingStats;
    this.index = {};
    this.renderedOpNames = [];

    this.computeScales();
    // Maps node name to whether the rendering hierarchy was already
    // constructed.
    this.hasSubhierarchy = {};
    this.root = new RenderGroupNodeInfo(hierarchy.root, hierarchy.graphOptions);
    this.index[hierarchy.root.name] = this.root;
    this.renderedOpNames.push(hierarchy.root.name);
    this.buildSubhierarchy(hierarchy.root.name);
    this.root.expanded = true;
    this.traceInputs = true;//false;
  }

  computeScales() {
    this.deviceColorMap = d3.scaleOrdinal<string>()
        .domain(this.hierarchy.devices)
        .range(_.map(d3.range(this.hierarchy.devices.length),
                     MetanodeColors.DEVICE_PALETTE));     

    let topLevelGraph = this.hierarchy.root.metagraph;
    
    const maxCardinality: any = d3.max(topLevelGraph.nodes(),
      (nodeName, index) => {
        let node = topLevelGraph.node(nodeName);
        // Some ops don't have stats at all.
        if (node.cardinality != null) {
          return node.cardinality;
        }
      });

    this.cardinalityScale = d3.scaleLinear<string, string>()
        .domain([0, maxCardinality!])
        .range(PARAMS.minMaxColors);

    // Find the maximum compute time. Use 0 as the minimum.
    let maxComputeTime:any = d3.max(topLevelGraph.nodes(),
        (nodeName, index) => {
      let node = topLevelGraph.node(nodeName);
      // Some ops don't have stats at all.
      if (node.stats != null) {
        return node.stats.getTotalMicros();
      }
    });
    this.computeTimeScale = d3.scaleLinear<string, string>()
        .domain([0, maxComputeTime!])
        .range(PARAMS.minMaxColors);

    this.edgeWidthSizedBasedScale = this.hierarchy.hasShapeInfo ?
      edge.EDGE_WIDTH_SIZE_BASED_SCALE :
      d3.scaleLinear()
        .domain([1, this.hierarchy.maxMetaEdgeSize])
        .range([edge.MIN_EDGE_WIDTH, edge.MAX_EDGE_WIDTH]);
  }

  /**
   * Get a previously created RenderNodeInfo by its node name.
   */
  getRenderNodeByName(nodeName: string): RenderNodeInfo {
    return this.index[nodeName];
  }

  /**
   * Get the underlying node in the hierarchical graph by its name.
   */
  getNodeByName(nodeName: string): Node {
    return this.hierarchy.node(nodeName);
  }

  /**
   * Get a previously created RenderNodeInfo for the specified node name,
   * or create one if it hasn't been created yet.
   */
  getOrCreateRenderNodeByName(nodeName: string): RenderNodeInfo {
    // Polymer may invoke this with null.
    if (!nodeName) {
      throw "illegal argument nodeName";
    }

    if (nodeName in this.index) {
      return this.index[nodeName];
    }

    let node = this.hierarchy.node(nodeName);
    // Exit early if the node does not exist in the hierarchy. This can happen
    // when a graph is reloaded while the infocard points to a node not visible
    // at the top-level.
    if (!node) {
      throw "node not found: illegal argument nodeName";
    }
    let renderInfo = node.isGroupNode ?
        new RenderGroupNodeInfo(<GroupNode>node, this.hierarchy.graphOptions) :
        new RenderNodeInfo(node);
    this.index[nodeName] = renderInfo;
    this.renderedOpNames.push(nodeName);

    renderInfo.cardinalityColor = this.cardinalityScale(node.cardinality);    
 
    // We only fade nodes when we're displaying stats.
    renderInfo.isFadedOut = this.displayingStats;

    if (node.isGroupNode) {
      // Make a list of tuples (device, proportion), where proportion
      // is the fraction of op nodes that have that device.
      let pairs = _.toPairs((<GroupNode>node).deviceHistogram);
      if (pairs.length > 0) {
        // Compute the total # of devices.
        let numDevices = _.sumBy(pairs, p => p[1]);
        renderInfo.deviceColors = _.map(pairs, pair => ({
              color: this.deviceColorMap!(pair[0]),
              // Normalize to a proportion of total # of devices.
              proportion: pair[1] / numDevices
            }));
      }
    } else {
      let device = (<OpNode>renderInfo.node).device;
      if (device) {
        renderInfo.deviceColors = [{
          color: this.deviceColorMap!(device),
          proportion: 1.0
        }];
      }
    }

    return this.index[nodeName];
  }

  /**
   * Return the nearest ancestor node, including itself, that is visible
   * in the visualization. This method is used so that we can select
   * (highlight) a node that isn't drawn yet, by selecting (highlighting)
   * its nearest ancestor that has been drawn.
   */
  getNearestVisibleAncestor(name: string): string {
    let path = getHierarchicalPath(name);
    let i = 0;
    let renderNode: RenderNodeInfo | null = null;
    // Fallthrough. If everything was expanded return the node.
    let nodeName = name;
    for (; i < path.length; i++) {
      nodeName = path[i];
      renderNode = this.getRenderNodeByName(nodeName);
      // Op nodes have expanded set to false by default.
      if (!renderNode.expanded) {
        break;
      }
    }

    // Check case where highlighted node is an embedded node whose parent node
    // is also its hierarchical parent. In this case, we want to return the
    // embedded node name, as it is also displayed if its parent has been
    // displayed.     
    if (renderNode && i == path.length - 2) {
      let nextName = path[i + 1];
      if (renderNode.inAnnotations.nodeNames[nextName]) {
        return nextName;
      }

      if (renderNode.outAnnotations.nodeNames[nextName]) {
        return nextName;
      }
    }

    return nodeName;
  }

  // TODO: Delete this an any code it touches (all deprecated).
  setDepth(depth: number): void {
    setGroupNodeDepth(this.root, +depth);
  }

  /**
   * Returns true if the renderNode is an isolated node within its parent node.
   */
  isNodeAuxiliary(renderNode: RenderNodeInfo): boolean {
    let parentNode = <RenderGroupNodeInfo>this.getRenderNodeByName(
      renderNode.node.parentNode.name);
    let found = _.find(parentNode.isolatedInExtract, node => {
      return node.node.name === renderNode.node.name;
    });
    if (found) {
      return true;
    }
    found = _.find(parentNode.isolatedOutExtract, node => {
      return node.node.name === renderNode.node.name;
    });
    return !!found;
  }

  /**
   * Returns a list of ops that have been rendered so far for this graph. More
   * ops may later be rendered if the user expands nodes for instance. The list
   * returned here can only stay the same size or grow on successive calls.
   */
  getNamesOfRenderedOps(): string[] {
    return this.renderedOpNames;
  }

  /**
   * Clones an op node and adds it to a metagraph. Does nothing if an op node
   * with the same new name has already been created within the metagraph. This
   * method is used when duplicating a library function to be injected within a
   * metanode representing a function call.
   * @param parentMetanode The parent metanode on which to add the new node.
   * @param node The op node to clone.
   * @param newPrefix The prefix string to use in lieu of the one that merely
   *     indicates that the metanode represents a function defined in the
   *     library. This prefix should reflect graph hierarchy.
   * @return The newly created op node (the clone of the original).
   */
  private cloneAndAddFunctionOpNode(
      parentMetanode: Metanode,
      libraryFunctionNodeName: string,
      node: OpNode,
      newPrefix: string): OpNode {
    const newName = node.name.replace(
        libraryFunctionNodeName, newPrefix);
    let _newOpNode = parentMetanode.metagraph.node(newName);
    if (_newOpNode) {
      // This node had already been created and added to the graph.
      return _newOpNode as OpNode;
    }

    let newOpNode:OpNode =
    // Create a new op node.
     new graph.OpNodeImpl(<NodeDef>{
      name: newName,
      input: [],
      device: node.device,
      op: node.op,
      nodeAttributes: _.cloneDeep(node.nodeAttributes),
    });
 
    // Update various properties.
    newOpNode.cardinality = node.cardinality;
    newOpNode.include = node.include;    
    newOpNode.functionInputIndex = node.functionInputIndex;
    newOpNode.functionOutputIndex = node.functionOutputIndex;

    // Update the inputs of the new node to reflect the new path.
    newOpNode.inputs = node.inputs.map(normalizedInput => {
      const newNormalizedInput = _.clone(normalizedInput);
      newNormalizedInput.name = normalizedInput.name.replace(
          libraryFunctionNodeName, newPrefix);
      return newNormalizedInput;
    });

    // Add the new op node to the hierarchy and metagraph. Also add it to its
    // parent metanode.
    newOpNode.parentNode = parentMetanode;
    parentMetanode.metagraph.setNode(newOpNode.name, newOpNode);
    this.hierarchy.setNode(newOpNode.name, newOpNode);

    // Update embeddings.
    const updateEmbeddingOpNode = embeddingNode => {
      return this.cloneAndAddFunctionOpNode(
          parentMetanode, libraryFunctionNodeName, embeddingNode, newPrefix);
    }
    newOpNode.inEmbeddings = node.inEmbeddings.map(updateEmbeddingOpNode);
    newOpNode.outEmbeddings = node.outEmbeddings.map(updateEmbeddingOpNode);

    return newOpNode;
  }

  /**
   * Clones a Metanode that represents a function defined in the graph library.
   * We dynamically inject a clone of a function into a meta graph when the user
   * expands a function call. We cannot do this at the beginning because the
   * functions may recursively call themselves or other functions.
   * @param metagraph The metagraph we are currently rendering the sub-hierarchy
   *     for.
   * @param opNodeToReplace The op node in the graph to replace with a new
   *     (expandable) metanode that visualizes the innards of a function.
   * @param libraryMetanode The metanode for a library function to clone.
   * @param oldPrefix The old prefix to replace (that just reflects how this
   *     node is for a library function).
   * @param newPrefix The prefix string to use in lieu of the one that merely
   *     indicates that the metanode represents a function defined in the
   *     library. This prefix should reflect graph hierarchy.
   */
  private cloneFunctionLibraryMetanode(
      metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>,
      opNodeToReplace: OpNode,
      libraryMetanode: Metanode,
      oldPrefix: string,
      newPrefix: string): Metanode {
    // Make a mapping between function output index and the new node for the
    // output.
    const functionOutputIndexToNode = {};

    const newMetanode = this.cloneFunctionLibraryMetanodeHelper(
        metagraph,
        opNodeToReplace,
        libraryMetanode,
        oldPrefix,
        newPrefix,
        functionOutputIndexToNode);

    if (!_.isEmpty(functionOutputIndexToNode)) {
      // After we have cloned the edges within the metanode, we still must add
      // edges that emanate out of output ops within the function.
      this.patchEdgesFromFunctionOutputs(
          opNodeToReplace, functionOutputIndexToNode);
    }

    return newMetanode;
  }

  /**
   * A helper subroutine that performs the bulk of the logic for
   * `cloneFunctionLibraryMetanode`.
   * @param metagraph The metagraph we are currently rendering the sub-hierarchy
   *     for.
   * @param opNodeToReplace The op node in the graph to replace with a new
   *     (expandable) metanode that visualizes the innards of a function.
   * @param libraryMetanode The metanode for a library function to clone.
   * @param oldPrefix The old prefix to replace (that just reflects how this
   *     node is for a library function).
   * @param newPrefix The prefix string to use in lieu of the one that merely
   *     indicates that the metanode represents a function defined in the
   *     library. This prefix should reflect graph hierarchy.
   * @param functionOutputIndexToNode A mapping between function output index
   *     and the corresponding output node. Used to connect outputs with
   *     destinations outside of the function metanode.
   */
  private cloneFunctionLibraryMetanodeHelper(
      metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>,
      opNodeToReplace: OpNode,
      libraryMetanode: Metanode,
      oldPrefix: string,
      newPrefix: string,
      functionOutputIndexToNode: {[key: string]: Node}): Metanode {
    const newMetanode = graph.createMetanode(
        libraryMetanode.name.replace(oldPrefix, newPrefix));

    // Copy over various properties.
    newMetanode.depth = libraryMetanode.depth;
    newMetanode.cardinality = libraryMetanode.cardinality;
    newMetanode.templateId = libraryMetanode.templateId;
    newMetanode.opHistogram = _.clone(libraryMetanode.opHistogram);
    newMetanode.deviceHistogram = _.clone(libraryMetanode.deviceHistogram);
    newMetanode.hasNonControlEdges = libraryMetanode.hasNonControlEdges;
    newMetanode.include = libraryMetanode.include;
    newMetanode.nodeAttributes = _.clone(libraryMetanode.nodeAttributes);
    newMetanode.associatedFunction = libraryMetanode.associatedFunction;

    // Recursively duplicate the children nodes.
    _.each(libraryMetanode.metagraph.nodes(), nodeName => {
      const node = libraryMetanode.metagraph.node(nodeName);

      switch (node.type) {
        case NodeType.META:
          // Recursively duplicate the metanode.
          const newNode = this.cloneFunctionLibraryMetanodeHelper(
              metagraph,
              opNodeToReplace,
              node as Metanode,
              oldPrefix,
              newPrefix,
              functionOutputIndexToNode);

          // Add the new node to the graph.
          newNode.parentNode = newMetanode;
          newMetanode.metagraph.setNode(newNode.name, newNode);
          this.hierarchy.setNode(newNode.name, newNode);
          break;
        case NodeType.OP:
          // Duplicate the op node.
          const newOpNode = this.cloneAndAddFunctionOpNode(
              newMetanode, oldPrefix, node as OpNode, newPrefix);
          if (_.isNumber(newOpNode.functionInputIndex)) {
            // This node represents an input_arg of the library function. Give
            // it edges so that its bridge edges are created correctly.
            this.patchEdgesIntoFunctionInputs(opNodeToReplace, newOpNode);
          }

          if (_.isNumber(newOpNode.functionOutputIndex)) {
            functionOutputIndexToNode[newOpNode.functionOutputIndex] =
                newOpNode;
          }
          break;
        default:
          // This logic should never run because the meta graph should only
          // contain meta and op nodes.
          console.warn(
              node.name + ' is oddly neither a metanode nor an opnode.');
      }
    });

    // Clone the edges within the function library metanode.
    this.cloneLibraryMetanodeEdges(
        libraryMetanode, newMetanode, oldPrefix, newPrefix);

    return newMetanode;
  }

  /**
   * Clones the edges within `libraryMetanode` and adds them to `newMetanode`.
   * The names of edge sources and destinations have their prefixes replaced
   * with new prefixes that reflect their hierarchical positions in the graph
   * instead of within the function library template. This is a subroutine for
   * dynamically injecting a function metanode into the graph.
   */
  private cloneLibraryMetanodeEdges(
      libraryMetanode: Metanode,
      newMetanode: Metanode,
      oldPrefix: string,
      newPrefix: string) {
    _.each(libraryMetanode.metagraph.edges(),
        (edgeObject: graphlib.EdgeObject) => {
      const edge = libraryMetanode.metagraph.edge(edgeObject);
      const newV = edge.v.replace(oldPrefix, newPrefix);
      const newW = edge.w.replace(oldPrefix, newPrefix);

      const newMetaEdge = new graph.MetaedgeImpl(newV, newW);

      // Duplicate various properties.
      newMetaEdge.inbound = edge.inbound;
      newMetaEdge.numRegularEdges = edge.numRegularEdges;
      newMetaEdge.numControlEdges = edge.numControlEdges;
      newMetaEdge.numRefEdges = edge.numRefEdges;
      newMetaEdge.totalSize = edge.totalSize;
      if (edge.baseEdgeList) {
        newMetaEdge.baseEdgeList = edge.baseEdgeList.map(baseEdge => {
          const newBaseEdge = _.clone(baseEdge);
          newBaseEdge.v = baseEdge.v.replace(oldPrefix, newPrefix);
          newBaseEdge.w = baseEdge.w.replace(oldPrefix, newPrefix);
          return newBaseEdge;
        });
      }

      // Set the direction of the edge based on whether it is inbound. The edge
      // is inbound if its destination is within the metagraph.
      if (newMetanode.metagraph.node(newW)) {
        newMetanode.metagraph.setEdge(newV, newW, newMetaEdge);
      } else {
        newMetanode.metagraph.setEdge(newW, newV, newMetaEdge);
      }
    });
  }

  /**
   * When a metanode representing a function is cloned and placed into the
   * graph, we must create edges between inputs into the function call and the
   * input ops within the function. This function performs that patching.
   */
  private patchEdgesIntoFunctionInputs(
      opNodeToReplace: OpNode, newOpNode: OpNode) {
    // If the last few raw inputs are the same node, previous graph logic
    // collapses them into a single normalized input.
    let inputIndex = Math.min(
        newOpNode.functionInputIndex,
        opNodeToReplace.inputs.length - 1);
    let newInput = _.clone(opNodeToReplace.inputs[inputIndex]);
    while (newInput.isControlDependency) {
      // Ignore control dependencies - they are not assigned to
      // input_args.
      inputIndex++;
      newInput = opNodeToReplace.inputs[inputIndex];
    }
    // Clone the normalized input object.
    newOpNode.inputs.push(newInput);

    // Update values in the corresponding edge in the high-level
    // metagraph.
    const originalMetaEdges = this.hierarchy.getPredecessors(
        opNodeToReplace.name);
    
    // Find the metaedge that the input index corresponds to.
    // A metaedge may correspond to several edges. For instance,
    // an edge may enter a series node.
    let originalMetaEdge: Metaedge;
    let regularEdgeCount = 0;
    _.each(originalMetaEdges.regular, metaEdge => {
      regularEdgeCount += metaEdge.numRegularEdges;
      if (regularEdgeCount > inputIndex) {
        originalMetaEdge = metaEdge;
        // Terminate the loop.
        return false;
      }
    });

    // Also change any base edges that point into the original node to
    // point to the input arg within the function. These are used to
    // make bridge edges.
    _.each(originalMetaEdge.baseEdgeList, edge => {
      if (edge.w === opNodeToReplace.name) {
        edge.w = newOpNode.name;
      }
      if (edge.v === opNodeToReplace.name) {
        edge.v = newOpNode.name;
      }
    });
  }

  /**
   * When a metanode representing a function is cloned and placed into the
   * graph, we must create edges between output ops within the new function
   * metanode to its successors. This function does that after scanning the
   * successors of the function call.
   */
  private patchEdgesFromFunctionOutputs(
      opNodeToReplace: OpNode,
      functionOutputIndexToDestinationNode: {[key: string]: Node}) {
    // Connect the outputs of the function to other ops.
    const originalMetaEdges = this.hierarchy.getSuccessors(
        opNodeToReplace.name);
    _.each(originalMetaEdges.regular, (metaedge) => {
      _.each(metaedge.baseEdgeList, baseEdge => {
        // Destination nodes within regular base edges are op nodes.
        const destinationNode = this.hierarchy.node(baseEdge.w) as OpNode;
        _.each(destinationNode.inputs, normalizedInput => {
          // If an output of the function is an input into the op, map it back
          // to the output within the function so bridge edges are computed.
          if (normalizedInput.name === opNodeToReplace.name) {
            // Map the output tensor index (which in this case is for sure
            // numeric because it is an output of a metanode) to the correct
            // function output.
            const outputNode = functionOutputIndexToDestinationNode[
                normalizedInput.outputTensorKey];
            normalizedInput.name = outputNode.name;
            normalizedInput.outputTensorKey = baseEdge.outputTensorKey;
          }
        });
      });

      // Modify the list of base edges to point from the output so that bridge
      // edges are correct.
      _.each(metaedge.baseEdgeList, (baseEdge) => {
        baseEdge.v =
            functionOutputIndexToDestinationNode[baseEdge.outputTensorKey].name;
        baseEdge.outputTensorKey = '0';
      });
    });
  }

  buildSubhierarchy(nodeName: string): void {
    // Terminate if the rendering hierarchy was already constructed
    // for this node.
    if (nodeName in this.hasSubhierarchy) {
      return;
    }

    // Record that we constructed the rendering hierarchy for this node, so we
    // don't construct it another time.
    this.hasSubhierarchy[nodeName] = true;

    let renderNodeInfo = this.index[nodeName];

    // If it is not a meta node or a series node, don't do anything.
    if (renderNodeInfo.node.type !== NodeType.META &&
        renderNodeInfo.node.type !== NodeType.SERIES) {
      return;
    }

    // At this point we know the rendering information is about a group node.
    let renderGroupNodeInfo = <RenderGroupNodeInfo> renderNodeInfo;
    let metagraph = renderGroupNodeInfo.node.metagraph;
    let coreGraph = renderGroupNodeInfo.coreGraph;

    const nodesThatGotCloned: graph.Node[] = [];
    const functionCallMetanodesToAdd: graph.Metanode[] = [];
     

    // Create render nodes to represent each child from the metagraph. Although
    // these will initially be added to the coreGraph, they may later be
    // extracted. Also, due to extraction, the coreGraph may contain disjoint
    // groups between which there is no visible path (other than annotations).
    _.each(metagraph.nodes(), childName => {

      let childRenderInfo = this.getOrCreateRenderNodeByName(childName);
      let childNode = childRenderInfo.node;

      coreGraph.setNode(childName, childRenderInfo);

      if (!childNode.isGroupNode) {
        _.each((<OpNode>childNode).inEmbeddings, embedding => {
          let renderMetaedgeInfo = new RenderMetaedgeInfo(null);
          let renderNodeInfo = new RenderNodeInfo(embedding);
          addInAnnotation(childRenderInfo, embedding, renderNodeInfo, renderMetaedgeInfo,
              AnnotationType.CONSTANT);
          this.index[embedding.name] = renderNodeInfo;
        });
        _.each((<OpNode>childNode).outEmbeddings, embedding => {
          let renderMetaedgeInfo = new RenderMetaedgeInfo(null);
          let renderNodeInfo = new RenderNodeInfo(embedding);
          addOutAnnotation(childRenderInfo, embedding, renderNodeInfo, renderMetaedgeInfo,
              AnnotationType.SUMMARY);
          this.index[embedding.name] = renderNodeInfo;
        });
      }

    });

    // Add render metaedge info for edges in the metagraph.
    _.each(metagraph.edges(), edgeObj => {
      let metaedge = metagraph.edge(edgeObj);
      let renderMetaedgeInfo = new RenderMetaedgeInfo(metaedge);
      renderMetaedgeInfo.isFadedOut =
          this.index[edgeObj.v].isFadedOut || this.index[edgeObj.w].isFadedOut;
      coreGraph.setEdge(edgeObj.v, edgeObj.w, renderMetaedgeInfo);
    });

    if (PARAMS.enableExtraction &&
        renderGroupNodeInfo.node.type === NodeType.META) {
      extractHighDegrees(renderGroupNodeInfo);
    }

    // Look up the parent node's render information and short circuit if none.
    let parentNode = renderGroupNodeInfo.node.parentNode;
    if (!parentNode) {
      return;
    }
    
 
  }

   
}

/**
 * A class for rendering annotation object which contains label
 * about the node embedded as annotation, type of annotation and the location
 * of both the annotation's node and edge.
 *
 * Annotation objects include embedded constants, embedded summary, and
 * edge shortcuts.
 */
export class Annotation implements EdgeData {
  node: Node;
  renderNodeInfo: RenderNodeInfo;
  renderMetaedgeInfo: RenderMetaedgeInfo|null;
  annotationType: AnnotationType;
  /**
   * Center position of annotation relative to the host
   * node's center x.
   */
  dx: number;
  /**
   * Center position of annotation relative to the host
   * node's center y.
   */
  dy: number;
  width: number;
  height: number;
  /**
   * The names of nodes on either side of this edge.
   */
  v: string;
  w: string;

  get label(): RenderMetaedgeInfo {
    return this.renderMetaedgeInfo;
  }
  /**
   * A flag whether it is an in-annotation (if true) or
   * out-annotation  (if false).
   */
  isIn: boolean;
  /** Label horizontal offset from the end of the node shape */
  labelOffset: number;
  /**
   * Array of points for edges from the annotation to its host
   * node. Each point contains the point location, relative to
   * the host node's center.
   */
  points: {dx: number, dy: number}[];

  /**
   * Creates a new Annotation.
   *
   * @param node The underlying node this annotation points to.
   * @param renderNodeInfo The render information for the underlying node
   *     this annotation points to. This can be null if the annotation
   *     denotes an embedding (constant, summary), in which case we
   *     use the node property.
   * @param renderMetaedgeInfo The render information for the edge associated
   *     with the annotation.
   * @param type The type of the annotation.
   * @param isIn True if it is an in-annotation. False if it is an
   *     out-annotation.
   */
  constructor(node: Node, renderNodeInfo: RenderNodeInfo,
      renderMetaedgeInfo: RenderMetaedgeInfo, type: AnnotationType,
      isIn: boolean) {
    
    this.v=UNKNOWN;
    this.w=UNKNOWN;
    this.node = node;
    this.renderNodeInfo = renderNodeInfo;
    this.renderMetaedgeInfo = renderMetaedgeInfo;
    this.annotationType = type;
    // Properties specified by layout
    this.dx = 0;
    this.dy = 0;
    this.width = 0;
    this.height = 0;
    // Properties needed for generating an ID for the edge's path element if
    // this annotation is associated with a metaedge.
    if (renderMetaedgeInfo && renderMetaedgeInfo.metaedge) {
      this.v = renderMetaedgeInfo.metaedge.v;
      this.w = renderMetaedgeInfo.metaedge.w;
    }

    this.isIn = isIn;
    this.points = [];
  }
};

export enum AnnotationType {SHORTCUT, CONSTANT, SUMMARY, ELLIPSIS};

/**
 * Manages a list of annotations. Two will be used for each
 * RenderNodeInfo, one for in annotations and one for out annotations.
 */
export class AnnotationList {
  /**
   * List of visually drawable annotations, may include an ellipses annotation
   * if the number added exceeds the number specified by maxAnnotations.
   */
  list: Annotation[];

  /**
   * Set of nodes which have been added as annotations to this list, so we can
   * prevent duplicates.
   */
  nodeNames: { [nodeName: string]: boolean };

  constructor() {
    this.list = [];
    this.nodeNames = {};
  }

  /**
   * Append an annotation to the list, or a stand-in ellipsis annotation instead
   * if this would make it too many.
   */
  push(annotation: Annotation): void {
    if (annotation.node.name in this.nodeNames) {
      return; // Skip duplicate annotation.
    }
    this.nodeNames[annotation.node.name] = true;

    if (this.list.length < PARAMS.maxAnnotations) {
      this.list.push(annotation);
      return;
    }

    let lastAnnotation = this.list[this.list.length - 1];
    if (lastAnnotation.annotationType === AnnotationType.ELLIPSIS) {
      let ellipsisNode = <EllipsisNode>lastAnnotation.node;
      ellipsisNode.setNumMoreNodes(++ellipsisNode.numMoreNodes);
      return;
    }

    let ellipsisNode = new graph.EllipsisNodeImpl(1);
    this.list.push(new Annotation(ellipsisNode,
        new RenderNodeInfo(ellipsisNode), null,
        AnnotationType.ELLIPSIS, annotation.isIn));
  }
}

/**
 * Contains rendering information about a node in the hierarchical graph.
 */
export class RenderNodeInfo {
  /** Reference to the original underlying Node from the hierarchical graph. */
  node: Node;
  /** Whether the node is expanded or not. */
  expanded: boolean;
  /**
   * List of rendering information about in-annotations like constants and
   * shortcuts to high-degree nodes.
   */
  inAnnotations: AnnotationList;
  /**
   * List of rendering information about out-annotations (e.g. summary nodes)
   */
  outAnnotations: AnnotationList;

  // --- Params specified by layout --- //

  /** Center x position */
  x: number;
  /** Center y position */
  y: number;
  /**
   * Total width of the node's shape, including in- and out-annotations. This
   * property is used by dagre to layout the graph.
   */
  width: number;
  /**
   * Total height of the node's shape, including in- and out-annotations. This
   * property is used by dagre to layout the graph.
   */
  height: number;
  /**
   * Size of the main box of the node, excluding in- and out-annotations. This
   * property is used to draw the rectangle/ellipse shape denoting the node.
   */
  coreBox: {
    width: number,
    height: number,
  };

  /** Width of the bounding box for all in-annotations. */
  inboxWidth: number;
  /** Width of the bounding box for all out-annotations. */
  outboxWidth: number;
  /**
   * Whether the node should be excluded from the scene.
   * This is only used when there are too many items in a series so we only
   * want to include top N ones.
   */
  // TODO: Now that series rendering is non-recursive, remove this and
  // all its uses from the code base.
  excluded: boolean;

  // --- Params used in drawing the bridge paths --- //

  /**
   * All bridge nodes are meant to be invisible, but whereas most represent a
   * relationship from the underlying graph hierarchy, some exist solely for
   * layout reasons. Specifically, those bridge nodes which have only structural
   * rendering metaedges.
   */
  structural: boolean;

  // --- Params for the size of the node box --- //

  /** Label vertical offset from the center of node shape */
  labelOffset: number;
  /** Rectangle radius (for making rounded rectangle) */
  radius: number;

  // --- Params for expanded node --- //

  /** Label height for expanded node. */
  labelHeight: number;
  // Paddings between inner subscene and the border of the expanded node.
  paddingTop: number;
  paddingLeft: number;
  paddingRight: number;
  paddingBottom: number;

  /**
   * Whether a node is extracted as source-like (having high out-degree or
   * matching predefined in-extract pattern.)
   */
  isInExtract: boolean;
  /**
   * Whether a node is extracted as sink-like (having high in-degree or matching
   * predefined out-extract pattern.)
   */
  isOutExtract: boolean;

  /**
   * Whether a node represents a function template within the library, in which
   * case it should be rendered in a special scene group.
   */
  isLibraryFunction: boolean;

  /**
   * List of (color, proportion) tuples based on the proportion of devices of
   * its children. If this node is an op node, this list will have only one
   * color with proportion 1.0.
   */
  deviceColors: Array<{color: string, proportion: number}>;


  cardinalityColor: string;

  /**
   * Color according to the compute time of this node.
   */
  computeTimeColor: string;

  /**
   * Whether this node is faded out. Used when displaying stats.
   */
  isFadedOut: boolean;

  /**
   * The name string used to label the node in the graph.
   */
  displayName: string;

  constructor(node: Node) {
    this.node = node;
    this.expanded = false;
    this.inAnnotations = new AnnotationList();
    this.outAnnotations = new AnnotationList();
    // Params specified by layout
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    this.inboxWidth = 0;
    this.outboxWidth = 0;

    this.excluded = false;

    // Params for bridge paths.
    this.structural = false;

    // Params for node box.
    this.labelOffset = 0;
    this.radius = 0;

    // Params for expanded node
    this.labelHeight = 0;
    this.paddingTop = 0;
    this.paddingLeft = 0;
    this.paddingRight = 0;
    this.paddingBottom = 0;
    this.isInExtract = false;
    this.isOutExtract = false;
    this.coreBox = {width: 0, height: 0};

    // By default, we don't fade nodes out. Default to false for safety.
    this.isFadedOut = false;

    // Only use the portion beyond the last delimiter as the display
    // name.
    this.displayName = node.name.substring(
        node.name.lastIndexOf(graph.NAMESPACE_DELIM) + 1);

    if (node.type === NodeType.META &&
        (node as Metanode).associatedFunction) {
      // Function names are suffixed with a length-8 hexadecimal string
      // followed by an optional number. We remove that suffix because
      // the user did not generate that suffix. That suffix merely
      // serves to differentiate between functions with different
      // signatures but the same name otherwise.
      // Furthermore, we remove the prefix that merely ascertains this
      // node as a function definition. There is no reason for the user
      // to see that in the graph, as the node would already be within
      // the functions scene group.
      const match = this.displayName.match(nodeDisplayNameRegex);
      if (match) {
        // The display name had been successfully extracted. This is the most
        // common scenario.
        this.displayName = match[1];
      }  
    }
  }

  isInCore(): boolean {
    return !this.isInExtract && !this.isOutExtract && !this.isLibraryFunction;
  }
}

/**
 * Contains rendering information about a Metaedge from the underlying
 * hierarchical graph. It may be from either a metagraph or a bridgegraph.
 */
export class RenderMetaedgeInfo {
  /**
   * Reference to the original underlying Metaedge from the hierarchical graph,
   * if any. This will be null for the edges which connect OpNodes to their
   * embeddings, for example.
   */
  metaedge: Metaedge | null;

  /**
   * Reference to the adjoining RenderMetaedgeInfo from the parent's
   * coreGraph. This is used during layout to determine the point at which this
   * edge should touch the node's bounding box. This property will be null for
   * edges which terminate at a node on both ends (all non-bridge edges).
   */
  adjoiningMetaedge: RenderMetaedgeInfo | null;

  /**
   * Most of the time, a RenderMetaedgeInfo object represents a real
   * edge between nodes in the underlying graph structure. But sometimes, an
   * edge only exists for layout purposes. These structural edges are added
   * during buildSubhierarchy() to force dagre.layout() to put bridge nodes
   * at the ends of the flow.
   * @see buildSubhierarchy()
   */
  structural: boolean;

  /**
   * Weight of the edge, used by dagre when deciding how important an edge is.
   * Edges with higher weight are made shorter and straighter. The default
   * dagre uses is 1.
   */
  weight: number;

  /**
   * X and Y coordinate pairs of the points in the path of the edge.
   * @see graph.node.subsceneAdjustPaths
   */
  points?: Point[];

  /**
   * D3 selection of the group containing the path that displays this edge.
   */
  edgeGroup?: d3.Selection<RenderMetaedgeInfo & any, any, any, any>;

  /** Id of the <marker> used as a start-marker for the edge path. */
  startMarkerId?: string;

  /** Id of the <marker> used as an end-marker for the edge path. */
  endMarkerId?: string;

  /**
   * Whether this edge is faded out. Used for fading out unused edges when
   * displaying run statistics.
   */
  isFadedOut: boolean;

  constructor(metaedge: Metaedge | null) {
    this.metaedge = metaedge;
    this.adjoiningMetaedge = null;
    this.structural = false;
    this.weight = 1;
    this.isFadedOut = false;
  }
}

function addInAnnotation(node: RenderNodeInfo, predecessor: Node,
    predecessorRenderInfo: RenderNodeInfo,
    edge: RenderMetaedgeInfo, type: AnnotationType): void {
  let annotation = new Annotation(predecessor, predecessorRenderInfo, edge,
      type, true);
  node.inAnnotations.push(annotation);
}

function addOutAnnotation(node: RenderNodeInfo, successor: Node,
    successorRenderInfo: RenderNodeInfo, edge: RenderMetaedgeInfo,
    type: AnnotationType): void {
  let annotation = new Annotation(successor, successorRenderInfo, edge,
      type, false);
  node.outAnnotations.push(annotation);
}

function setGraphDepth(graph: graphlib.Graph<RenderNodeInfo, any>,
  depth: number) {
  _.each(graph.nodes(), nodeName => {
    let child = graph.node(nodeName);
    child.expanded = depth > 1; // set all child of depth 1 to collapsed
    if (depth > 0) {
      switch (child.node.type) {
        case NodeType.META:
        case NodeType.SERIES:
          setGroupNodeDepth(<RenderGroupNodeInfo>child, depth - 1);
          break;
        // Do nothing for leaf
      }
    }
  });
};

export class RenderGroupNodeInfo extends RenderNodeInfo {
  node: GroupNode;
  /**
   * The core graph is derived from the underlying node's metagraph, minus
   * the extracted source-like and sink-like nodes.
   */
  coreGraph: graphlib.Graph<RenderNodeInfo, RenderMetaedgeInfo>;
  /** Size of the bounding box for a metanode's isolated in-extract children. */
  inExtractBox: {width: number, height: number};
  /**
   * Size of the bounding box for a metanode's isolated out-extract children.
   */
  outExtractBox: {width: number, height: number};
  /** Size of the bounding box for the function library. */
  libraryFunctionsBox: {width: number, height: number};
  /** Array of isolated in-extract nodes. */
  isolatedInExtract: RenderNodeInfo[];
  /** Array of isolated out-extract nodes. */
  isolatedOutExtract: RenderNodeInfo[];
  /** Array of nodes to show in the function library scene group. */
  libraryFunctionsExtract: RenderNodeInfo[];

  constructor(groupNode: GroupNode, graphOptions: graphlib.GraphOptions) {
    super(groupNode);
    let metagraph = groupNode.metagraph;
    let gl = metagraph.graph();
    graphOptions.compound = true;
    this.coreGraph =
        createGraph<RenderNodeInfo, RenderMetaedgeInfo>(
            gl.name, GraphType.CORE, graphOptions);
    this.inExtractBox = {width: 0, height: 0};
    this.outExtractBox = {width: 0, height: 0};
    this.libraryFunctionsBox = {width: 0, height: 0};
    this.isolatedInExtract = [];
    this.isolatedOutExtract = [];
    this.libraryFunctionsExtract = [];
  }
}

function setGroupNodeDepth(renderInfo: RenderGroupNodeInfo,
    depth: number): void {
  if (renderInfo.coreGraph) {
    setGraphDepth(renderInfo.coreGraph, depth);
  }
}

/**
 * Remove an edge from the graph and add annotations to both ends of the edge.
 *
 * @param The core graph.
 * @param v Source name.
 * @param w Sink name.
 */
function createShortcut(
  graph: graphlib.Graph<RenderNodeInfo, RenderMetaedgeInfo>,
  v: string, w: string) {
  let src = graph.node(v);
  let sink = graph.node(w);
  let edge = graph.edge(v, w);

  // If either of the nodes is explicitly included in the main graph and
  // both nodes are in the main graph then do not create the shortcut
  // and instead keep the real edge.
  if ((src.node.include === InclusionType.INCLUDE ||
       sink.node.include === InclusionType.INCLUDE) &&
      src.node.include !== InclusionType.EXCLUDE &&
      sink.node.include !== InclusionType.EXCLUDE) {
    return;
  }

  // Add each annotation.
  addOutAnnotation(src, sink.node, sink, edge, AnnotationType.SHORTCUT);
  addInAnnotation(sink, src.node, src, edge, AnnotationType.SHORTCUT);

  // Remove the edge from the core graph.
  graph.removeEdge(v, w);
}

/**
 * Remove edges from a node, and set its isOutExtract property to true,
 * and remove the node and move it to isolatedOutExtract.
 *
 * If detachAllEdgesForHighDegree or forceDetach is true, extract all of its
 * edges. Otherwise, only extract all in-edges.
 */
function makeOutExtract(renderNode: RenderGroupNodeInfo, n: string,
    forceDetach?: boolean) {
  let graph = renderNode.coreGraph;
  let child = graph.node(n);
  child.isOutExtract = true;

  _.each(graph.predecessors(n), (p, index) => {
    createShortcut(graph, p, n);
  });

  if (PARAMS.detachAllEdgesForHighDegree || forceDetach) {
    _.each(graph.successors(n), (s, index) => {
      createShortcut(graph, n, s);
    });
  }

  // Remove the node from the core graph if it no longer has neighbors.
  if (graph.neighbors(n).length === 0) {
    child.node.include = InclusionType.EXCLUDE;
    renderNode.isolatedOutExtract.push(child);
    graph.removeNode(n);
  }
}

/**
 * Remove edges from a node, set its isInExtract property to true,
 * and remove the node and move it to isolatedInExtract.
 *
 * If detachAllEdgesForHighDegree or forceDetach is true, extract all of its
 * edges. Otherwise, only remove all out-edges.
 */
export function makeInExtract(renderNode: RenderGroupNodeInfo, n: string,
    forceDetach?: boolean) {
  let graph = renderNode.coreGraph;
  let child = graph.node(n);
  child.isInExtract = true;

  _.each(graph.successors(n), (s, index) => {
    createShortcut(graph, n, s);
  });

  if (PARAMS.detachAllEdgesForHighDegree || forceDetach) {
    _.each(graph.predecessors(n), (p, index) => {
      createShortcut(graph, p, n);
    });
  }

  // Remove the node from the core graph if it no longer has neighbors.
  if (graph.neighbors(n).length === 0) {
    child.node.include = InclusionType.EXCLUDE;
    renderNode.isolatedInExtract.push(child);
    graph.removeNode(n);
  }
}

/**
 * Check whether the node's type is a member of the given list of types.
 *
 * @param node Node.
 * @param types List of type to match.
 */
function hasTypeIn(node: Node, types: string[]): boolean {
  if (node.type === NodeType.OP) {
    for (let i = 0; i < types.length; i++) {
      if ((<OpNode>node).op === types[i]) { return true; }
    }
  } else if (node.type === NodeType.META) {
    let rootOpNode = (<Metanode>node).getRootOp();
    if (rootOpNode) {
      for (let i = 0; i < types.length; i++) {
        if (rootOpNode.op === types[i]) { return true; }
      }
    }
  }
  return false;
}

/** Move nodes that are specified to be excluded out of the core graph. */
function extractSpecifiedNodes(renderNode: RenderGroupNodeInfo) {
  let graph = renderNode.coreGraph;
  _.each(graph.nodes(), n => {
    let renderInfo = graph.node(n);
    if (renderInfo.node.include === InclusionType.EXCLUDE) {
      // Move the node if the node is excluded and not part of the library
      // function scene group, which contains nodes that do not represent ops in
      // the graph and should thus never have its nodes added to the core graph.
      if (renderNode.coreGraph.outEdges(n).length >
          renderNode.coreGraph.inEdges(n).length) {
        makeOutExtract(renderNode, n, true);
      } else {
        makeInExtract(renderNode, n, true);
      }
    }
  });
}

/** Remove edges from pre-defined out-extract patterns */
function extractPredefinedSink(renderNode: RenderGroupNodeInfo) {
  let graph = renderNode.coreGraph;
  _.each(graph.nodes(), n => {
    let renderInfo = graph.node(n);
    if (renderInfo.node.include !== InclusionType.UNSPECIFIED) {
      return;
    }
    if (hasTypeIn(renderInfo.node, PARAMS.outExtractTypes)) {
      makeOutExtract(renderNode, n);
    }
  });
}

/** Remove edges from pre-defined in-extract patterns */
function extractPredefinedSource(renderNode) {
  let graph = renderNode.coreGraph;
  _.each(graph.nodes(), n => {
    let renderInfo = graph.node(n);
    if (renderInfo.node.include !== InclusionType.UNSPECIFIED) {
      return;
    }
    if (hasTypeIn(renderInfo.node, PARAMS.inExtractTypes)) {
      makeInExtract(renderNode, n);
    }
  });
}

/** Extract nodes deemed to have either high in-degree or high out-degree. */
function extractHighInOrOutDegree(renderNode: RenderGroupNodeInfo) {
  let graph = renderNode.coreGraph;

  // Create mappings from node to in and out degrees. Count the number of valid
  // nodes along the way.
  let nodeToInDegree:{[key:string]:number} = {};
  let nodeToOutDegree:{[key:string]:number} = {};
  let validNodeCount = 0;
  _.each(graph.nodes(), currentNode => {
    if (graph.node(currentNode).node.include !== InclusionType.UNSPECIFIED) {
      // This node is not included in the first place.
      return;
    }

    // Count the in and out degrees based on only regular edges, unless there
    // are no regular edges, in which case use the number of control edges.
    // This is done so that control edges don't affect if nodes are extracted
    // from the core graph, unless the node is only used for control.
    let inDegree =
        _.reduce(graph.predecessors(currentNode), (inDegree, pred) => {
          let metaedge = graph.edge(pred, currentNode).metaedge;
          return inDegree + (metaedge!.numRegularEdges ? 1 : 0);
        }, 0);
    if (inDegree === 0 && graph.predecessors(currentNode).length > 0) {
      inDegree = graph.predecessors(currentNode).length;
    }

    let outDegree =
        _.reduce(graph.successors(currentNode), (outDegree, succ) => {
          let metaedge = graph.edge(currentNode, succ).metaedge;
          return outDegree + (metaedge!.numRegularEdges ? 1 : 0);
        }, 0);
    if (outDegree === 0 && graph.successors(currentNode).length > 0) {
      outDegree = graph.successors(currentNode).length;
    }

    // Store the in and out degrees of this node to avoid recomputing.
    nodeToInDegree[currentNode] = inDegree;
    nodeToOutDegree[currentNode] = outDegree;
    validNodeCount++;
  });

  if (validNodeCount < PARAMS.minNodeCountForExtraction) {
    // This graph has few nodes. Do not extract any nodes.
    return;
  }

  // We only extract if the node has a min in or out degree greater than this.
  let minUpperBound = PARAMS.minDegreeForExtraction - 1;

  // Mark for extraction nodes with in-degree > Q3 + (Q3 - Q1).
  let q3Index = Math.round(validNodeCount * 0.75);
  let q1Index = Math.round(validNodeCount * 0.25);
  let sortedByInDegree = Object.keys(nodeToInDegree).sort((node0, node1) => {
    return nodeToInDegree[node0] - nodeToInDegree[node1];
  });
  let inDegreeQ3 = nodeToInDegree[sortedByInDegree[q3Index]];
  let inDegreeQ1 = nodeToInDegree[sortedByInDegree[q1Index]];
  let inDegreeUpperBound = inDegreeQ3 + inDegreeQ3 - inDegreeQ1;
  // Only extract if the upper bound is high enough.
  inDegreeUpperBound = Math.max(inDegreeUpperBound, minUpperBound);
  for (let i = validNodeCount - 1;
       nodeToInDegree[sortedByInDegree[i]] > inDegreeUpperBound; i--) {
    // Extract a high in-degree node.
    makeInExtract(renderNode, sortedByInDegree[i]);
  }

  // Mark for extraction nodes with out-degree > Q3 + (Q3 - Q1) * 4.
  let sortedByOutDegree = Object.keys(nodeToOutDegree).sort((node0, node1) => {
    return nodeToOutDegree[node0] - nodeToOutDegree[node1];
  });
  let outDegreeQ3 = nodeToOutDegree[sortedByOutDegree[q3Index]];
  let outDegreeQ1 = nodeToOutDegree[sortedByOutDegree[q1Index]];
  // The upper bound for extracting out-degree nodes is higher than that for
  // extracting in-degree ones (Note the "* 4") because, in practice, some
  // graphs look worse with a smaller out-degree bound. For instance, a smaller
  // out-degree bound removes the convolution nodes from cifar 10 train's graph.
  let outDegreeUpperBound = outDegreeQ3 + (outDegreeQ3 - outDegreeQ1) * 4;
  // Only extract if the upper bound is high enough.
  outDegreeUpperBound = Math.max(outDegreeUpperBound, minUpperBound);
  for (let i = validNodeCount - 1;
       nodeToOutDegree[sortedByOutDegree[i]] > outDegreeUpperBound; i--) {
    let node = graph.node(sortedByOutDegree[i]);
    if (!node || node.isInExtract) {
      // This node has already been extracted due to high in-degree. It might
      // have been removed from the graph in general (during in-degree
      // extraction) due to a lack of neighbors. Do not extract this node twice.
      continue;
    }

    // Extract a high out-degree node that has not already been extracted.
    makeOutExtract(renderNode, sortedByOutDegree[i]);
  }
}

/** Remove control edges from nodes that have too many control edges */
function removeControlEdges(renderNode: RenderGroupNodeInfo) {
  let graph = renderNode.coreGraph;

  // Collect control edges into a map by node name.
  let map = <{[nodeName: string]: graphlib.EdgeObject[]}>{};
  _.each(graph.edges(), e => {
    if (!graph.edge(e).metaedge!.numRegularEdges) {
      (map[e.v] = map[e.v] || []).push(e);
      (map[e.w] = map[e.w] || []).push(e);
    }
  });

  // For each node with too many control edges, turn them into annotations.
  _.each(map, (edges, nodeName) => {
    if (edges.length > PARAMS.maxControlDegree) {
      _.each(edges, e => createShortcut(graph, e.v, e.w));
    }
  });
}

/**
 * Given an integer, picks a hue that is far apart from other colors.
 * The formula for picking color that avoid collision is:
 *     hue = (color range * golden ratio * index) % color range
 */
export function mapIndexToHue(id: number): number {
  let GOLDEN_RATIO = 1.61803398875;
  // Hue of 0 is reserved for the gray nodes.
  let MIN_HUE = 1;
  let MAX_HUE = 359;
  let COLOR_RANGE = MAX_HUE - MIN_HUE;
  return MIN_HUE + ((COLOR_RANGE * GOLDEN_RATIO * id) % COLOR_RANGE);
};

/**
 * Remove edges and add to annotation instead.
 *
 * For root node, consider predefined types for source and sink.
 * We do not extract predefined type from non-root so that Variables and the
 * sgd node (op type = 'NoOp') do not get extract from inside own group.
 *
 * The order of extraction is important here as swapping the order can totally
 * screw up the graph layout.
 *
 * @param {Render.Node} renderNode Node to manipulate.
 */
function extractHighDegrees(renderNode: RenderGroupNodeInfo) {

  extractSpecifiedNodes(renderNode);

  if (PARAMS.outExtractTypes) {
    extractPredefinedSink(renderNode);
  }

  // This has to come before extract high in-degree to protect the core part
  // that takes many variables.
  if (PARAMS.inExtractTypes) {
    extractPredefinedSource(renderNode);
  }

  extractHighInOrOutDegree(renderNode);

  if (PARAMS.maxControlDegree) {
    removeControlEdges(renderNode);
  }

  // Extract isolated nodes, which can be
  // (1) source-like and sink-like nodes that are not originally isolated but
  //     become isolated after further removal.
  // (2) isolated nodes with annotations on one-side.  These might be either
  //     - nodes that originally have high out-degree but because we remove
  //       high in-degree nodes first, they no longer have high in-degree when
  //       we check.  (Detecting all high-degree before removing also leads to
  //       another problem.)
  //     - nodes that do not have high degree, but their neighbors are all
  //       extracted, so it might make sense to extract them too.

  let graph = renderNode.coreGraph;
  _.each(graph.nodes(), n => {
    let child = graph.node(n);
    let degree = graph.neighbors(n).length;
    if (child.node.include !== InclusionType.UNSPECIFIED) {
      return;
    }
    if (degree === 0) {
      let hasOutAnnotations = child.outAnnotations.list.length > 0;
      let hasInAnnotations = child.inAnnotations.list.length > 0;

      if (child.isInExtract) { // Is source-like.
        // This case only happens if detachAllEdgesForHighDegree is false.
        // (Otherwise all source-like nodes are all isolated already.)
        renderNode.isolatedInExtract.push(child);
        child.node.include = InclusionType.EXCLUDE;
        graph.removeNode(n);
      } else if (child.isOutExtract) { // Is sink-like.
        // This case only happens if detachAllEdgesForHighDegree is false.
        // // (Otherwise all sink-like nodes are all isolated already.)
        renderNode.isolatedOutExtract.push(child);
        child.node.include = InclusionType.EXCLUDE;
        graph.removeNode(n);
      } else if (PARAMS.extractIsolatedNodesWithAnnotationsOnOneSide) {
        if (hasOutAnnotations && !hasInAnnotations) {
          child.isInExtract = true; // for ones with high out-annotations
          renderNode.isolatedInExtract.push(child);
          child.node.include = InclusionType.EXCLUDE;
          graph.removeNode(n);
        } else if (hasInAnnotations && !hasOutAnnotations) {
          child.isOutExtract = true; // for ones with high in-annotations
          renderNode.isolatedOutExtract.push(child);
          child.node.include = InclusionType.EXCLUDE;
          graph.removeNode(n);
        } else {
          // if a low degree node has both in- & out- annotations, do nothing
          // because it is unclear which side it should go to.
        }
      }
    }
  });
}

/**
 * Expands nodes in the graph until the desired node is visible.
 *
 * @param scene The scene polymer component.
 * @param renderHierarchy The render hierarchy.
 * @param tensorName The name of a tensor.
 * @return A string that is the name of the node representing the given tensor.
 *     Note that the original tensor name might differ from this returned node
 *     name. Specifically, for instance, the tensor name usually ends with an
 *     output slot index (such as :0), while the node name lacks that suffix.
 */
export function expandUntilNodeIsShown(
    scene:any, renderHierarchy:any, tensorName: string) {
  const splitTensorName = tensorName.split('/');

  // Graph names do not take into account the output slot. Strip it.
  const lastNodeNameMatch:RegExpMatchArray|null =
      splitTensorName[splitTensorName.length - 1].match(/(.*):\w+/);
  if (lastNodeNameMatch && lastNodeNameMatch.length === 2) {
    splitTensorName[splitTensorName.length - 1] = lastNodeNameMatch[1];
  }

  let nodeName = splitTensorName[0];
  let renderNode = renderHierarchy.getRenderNodeByName(nodeName);
  for (let i = 1; i < splitTensorName.length; i++) {
    // Op nodes are not expandable.
    if (renderNode.node.type ===  graph.NodeType.OP) {
      break;
    }
    renderHierarchy.buildSubhierarchy(nodeName);
    renderNode.expanded = true;
    scene.setNodeExpanded(renderNode);
    nodeName += '/' + splitTensorName[i];
    renderNode = renderHierarchy.getRenderNodeByName(nodeName);
  }

  return renderNode.node.name;
}
