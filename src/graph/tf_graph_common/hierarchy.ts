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
 * Package for the Graph Hierarchy for TensorFlow graph.
 */
import * as graphlib from 'graphlib'; 

import * as _ from "lodash";
import * as d3 from 'd3';
import * as graph from './graph';
import * as util from './util';
import { ProgressTracker } from './common';
import { SeriesNode, Metaedge, OpNode, GroupNode, getSeriesNodeName, createSeriesNode, Metanode, SlimGraph, NodeType, SeriesGroupingType, ROOT_NAME, createMetanode, MetaedgeImpl, createMetaedge, getHierarchicalPath, Node } from './graph';
import { StepStats } from './proto';
 


declare type GraphEx= graphlib.Graph<GroupNode|OpNode, Metaedge>;
/**
 * Class used as output for getPredecessors and getSuccessors methods
 */
export interface Edges {
  control: Metaedge[];
  regular: Metaedge[];
}

/**
 * Class used to store data on library functions. This specifically stores data
 * on the library function, not individual calls to those functions.
 */
export interface LibraryFunctionData {
  // The metanode representing this function in the library scene group.
  node: Metanode;

  // A list of nodes that represent calls to this library function.
  usages: Node[];
}

export interface Hierarchy {
  root: Metanode;
  libraryFunctions: {[key: string]: LibraryFunctionData};
  templates: {[templateId: string]: string[]};
  /** List of all device names */
  devices: string[];
  /** List of all XLA cluster names */
  xlaClusters: string[];
  /** True if at least one tensor in the graph has shape information */
  hasShapeInfo: boolean;
  /** The maximum size across all meta edges. Used for scaling thickness. */
  maxMetaEdgeSize: number;
  graphOptions: graphlib.GraphOptions;
  getNodeMap(): {[nodeName: string]: GroupNode|OpNode};
  node(name: string): GroupNode|OpNode;
  setNode(name: string, node: GroupNode|OpNode): void;
  // getBridgegraph(nodeName: string): graphlib.Graph<GroupNode|OpNode, Metaedge> | null;
  getPredecessors(nodeName: string): Edges;
  getSuccessors(nodeName: string): Edges;
  getTopologicalOrdering(nodeName: string): { [childName: string]: number } | null;
  getTemplateIndex(): (string:string) => number;
}

/**
 * Class for the Graph Hierarchy for TensorFlow graph.
 */
class HierarchyImpl implements Hierarchy {
  root: Metanode;
  libraryFunctions: {[key: string]: LibraryFunctionData};
  templates: {[templateId: string]: string[]};
  private index: {[nodeName: string]: GroupNode|OpNode};
  devices: string[];
  xlaClusters: string[];
  hasShapeInfo = false;
  maxMetaEdgeSize = 1;
  orderings: { [nodeName: string]: { [childName: string]: number } };
  graphOptions: graphlib.GraphOptions;

  /**
   * Constructs a hierarchy.
   * @param graphOptions Options passed to dagre for creating the graph. Note
   *   that the `compound` argument will be overriden to true.
   */
  constructor(graphOptions: graphlib.GraphOptions) {
    this.graphOptions = graphOptions || {};
    this.graphOptions.compound = true;
    this.root = createMetanode(ROOT_NAME, this.graphOptions);
    this.libraryFunctions = {};
    this.templates = {};
    this.devices = [];
    this.xlaClusters=[];
    /**
     * @type {Object} Dictionary object that maps node name to the node
     * (could be op-node, metanode, or series-node)
     */
    this.index = {};
    this.index[ROOT_NAME] = this.root;
    this.orderings = {};
  }

  getNodeMap(): {[nodeName: string]: GroupNode|OpNode} {
    return this.index;
  }

  node(name: string): GroupNode|OpNode {
    return this.index[name];
  }

  setNode(name: string, node: GroupNode|OpNode): void {
    this.index[name] = node;
  }

   
   

  /**
   * Utility function for determining the name of the immediate child under a
   * node for a given descendant path. If the descendant corresponds to no
   * immediate child, an error is thrown.
   */
  getChildName(nodeName: string, descendantName: string): string {
    // Walk up the hierarchy from the descendant to find the child.
    let currentNode: graph.Node = this.index[descendantName];
    while (currentNode) {
      if (currentNode.parentNode && currentNode.parentNode.name === nodeName) {
        return currentNode.name;
      }
      currentNode = currentNode.parentNode;
    }
    throw Error(
        'Could not find immediate child for descendant: ' + descendantName);
  };

  /** Given the name of a node, return its incoming metaedges. */
  getPredecessors(nodeName: string): Edges {
    let node = this.index[nodeName];
    if (!node) {
      throw Error('Could not find node with name: ' + nodeName);
    }

    let predecessors = this.getOneWayEdges(node, true);
    // Add embedded predecessors, such as constants.
    if (!node.isGroupNode) {
      _.each((<OpNode>node).inEmbeddings, embeddedNode => {
        _.each((<OpNode>node).inputs, input => {
          if (input.name === embeddedNode.name) {
            // Make a new metaedge holding the edge between the
            // node and the in-embedding.
            let metaedge = new MetaedgeImpl(embeddedNode.name, nodeName);
            metaedge.addBaseEdge(
                {
                  isControlDependency: input.isControlDependency,
                  outputTensorKey: input.outputTensorKey,
                  isReferenceEdge: false,
                  v: embeddedNode.name,
                  w: nodeName
                },
                this);
            predecessors.regular.push(metaedge);
          }
        });
      });
    }
    return predecessors;
  }

  /**
   * Given the name of a node, return its outgoing metaedges.
   *
   * This is the inverse of getPredecessors(). See that method's documentation
   * for an in-depth example.
   */
  getSuccessors(nodeName: string): Edges {
    let node = this.index[nodeName];
    if (!node) {
      throw Error('Could not find node with name: ' + nodeName);
    }

    let successors = this.getOneWayEdges(node, false);

    // Add embedded successors, such as summaries.
    if (!node.isGroupNode) {
      _.each((<OpNode>node).outEmbeddings, embeddedNode => {
        _.each(embeddedNode.inputs, input => {
          if (input.name === nodeName) {
            // Make a new metaedge holding the edge between the
            // node and the out-embedding.
            let metaedge = new MetaedgeImpl(nodeName, embeddedNode.name);
            metaedge.addBaseEdge(
                {
                  isControlDependency: input.isControlDependency,
                  outputTensorKey: input.outputTensorKey,
                  isReferenceEdge: false,
                  v: nodeName,
                  w: embeddedNode.name
                },
                this);
            successors.regular.push(metaedge);
          }
        });
      });
    }
    return successors;
  }

  /** Helper method for getPredecessors and getSuccessors */
  getOneWayEdges(node: GroupNode|OpNode, inEdges: boolean) {
    let edges: Edges = {control: [], regular: []};
    // A node with no parent cannot have any edges.
    if (!node.parentNode || !node.parentNode.isGroupNode) {
      return edges;
    }
    let parentNode = <GroupNode> node.parentNode;
    let metagraph = parentNode.metagraph;
    findEdgeTargetsInGraph(metagraph, node, inEdges, edges);
    return edges;
  }

  /**
   * For a given GroupNode, get or calculate an object which describes a
   * topological ordering of child nodes within that GroupNode's metagraph.
   *
   * This ordering is used when rendering bridge control edges which are
   * sometimes backwards relative to the dataflow.
   *
   * For example, say we have a graph with two edges A->B and A->C, and we're
   * interested in the ordering under ROOT. In this case, any of the following
   * would be legitimate return values:
   *
   *  - { 'A': 0, 'B': 1, 'C': 2 } -- most likely
   *  - { 'A': 0, 'B': 2, 'C': 1 } -- less likely
   *  - { 'A': 12, 'B': 100, 'C': 99 } -- unlikely, but still OK
   *
   * The algorithm does not guarantee that all numbers from 0-N (where N is
   * the number of nodes) appear exactly once. Rather it guarantees that if
   * there is a path between two nodes, the earlier one will have a lower
   * number in the ordering hash.
   *
   * When generating the ordering, we ignore control Metaedges (those which
   * represent only BaseEdges that have isControlDependency set to true).
   *
   * If there is no node with the specified name, an error is thrown. If the
   * node with the specified name is not a group node, null is returned.
   */
  getTopologicalOrdering(nodeName: string): { [childName: string]: number } | null{
    let node = this.index[nodeName];
    if (!node) {
      throw Error('Could not find node with name: ' + nodeName);
    }
    if (!node.isGroupNode) {
      return null;
    }
    if (nodeName in this.orderings) {
      return this.orderings[nodeName];
    }

    // Mapping of a child node names to lists of their successors.
    let successors: { [childName: string]: string[] } = {};

    // Set of node names which have appeared as a destination.
    let destinations: { [childName: string]: boolean } = {};

    let metagraph = (<GroupNode> node).metagraph;
    _.each(metagraph.edges(), (e: graphlib.EdgeObject) => {
      if (!metagraph.edge(e).numRegularEdges) {
        return; // Skip control edges.
      }

      // Keep track of successors and destinations.
      if (!(e.v in successors)) {
        successors[e.v] = [];
      }
      successors[e.v].push(e.w);
      destinations[e.w] = true;
    });

    // Seed the queue with true sources (those that are not destinations).
    let queue: string[] =
      _.difference(_.keys(successors), _.keys(destinations));

    // Produce an ordering by traversing the graph breadth first.
    let ordering:{[key:string]:number} = this.orderings[nodeName] = {};
    let index = 0;
    while (queue.length) {
      let childName = queue.shift();
      if(childName){
        ordering[childName] = index++;
        _.each(successors[childName], succName => queue.push(succName));
        delete successors[childName]; // Prevent cycles from infinite looping.
      }      
    }
    return ordering;
  }

  /**
   * Returns a d3 Ordinal function that can be used to look up the index of
   * a node based on its template id.
   */
  getTemplateIndex(): (string:string) => number {
    let templateNames = d3.keys(this.templates);
    let templateIndex = d3.scaleOrdinal()
        .domain(templateNames)
        .range(d3.range(0, templateNames.length));
    return (templateId: string) => <number>templateIndex(templateId);
  }
}

/**
 * Internal utility function - given a graph (should be either a metagraph or a
 * bridgegraph) and a node which is known to be in that graph, determine
 * the other ends of edges that involve that node in the direction specified
 * by whether it's inbound.
 *
 * For example if you wanted to find the predecessors of a node, you'd call
 * this method for the parent's metagraph and bridgegraph, specifying inbound
 * as true (look at the source of inbound edges to the specified node).
 *
 * Discovered target names are appended to the targets array.
 */
function findEdgeTargetsInGraph(
    graph: graphlib.Graph<GroupNode|OpNode, Metaedge> | null,
    node: Node, inbound: boolean, targets: Edges): void {
  
  if(graph===null) return;

  let edges = inbound ? graph.inEdges(node.name) : graph.outEdges(node.name);
  _.each(edges, e => {
    let metaedge = graph.edge(e);
    let targetList =
        metaedge.numRegularEdges ? targets.regular : targets.control;
    targetList.push(metaedge);
  });
}

export interface HierarchyParams {
  verifyTemplate: boolean;
  seriesNodeMinSize: number;
  seriesMap: { [name: string]: graph.SeriesGroupingType };
  // This string is supplied to dagre as the 'rankdir' property for laying out
  // the graph. TB, BT, LR, or RL. The default is 'BT' (bottom to top).
  rankDirection: string;
  // Whether to detect numeric patterns for series nodes using entire names of
  // nodes. If false, only uses numeric suffixes to find patterns to collapse
  // into series nodes.
  useGeneralizedSeriesPatterns: boolean;
}

/**
 * @param graph The raw graph.
 * @param params Parameters used when building a hierarchy.
 */
export function build(graph:  SlimGraph, params: HierarchyParams,
    tracker: ProgressTracker): Promise<Hierarchy|void> {

  let h = new HierarchyImpl({'rankdir': params.rankDirection});
  let seriesNames: { [name: string]: string } = {};
  
  return util
      .runAsyncTask(
          'Adding nodes', 20,
          () => {
            // Get all the possible device and XLA cluster names.
            let deviceNames:{[key:string]:boolean} = {};
            _.each(graph.nodes, (node, nodeName) => {
              if (node.device) {
                deviceNames[node.device] = true;
              }
            });

            h.devices = _.keys(deviceNames);
 
            addNodes(h, graph);
          },
          tracker)
      .then(() => {
        return util.runAsyncTask('Detect series', 20, () => {
          if (params.seriesNodeMinSize > 0) {
            groupSeries(
                h.root, h, seriesNames, params.seriesNodeMinSize,
                params.seriesMap, params.useGeneralizedSeriesPatterns);
          }
        }, tracker);
      })
      .then(() => {
        return util.runAsyncTask('Adding edges', 60, () => {
          addEdges(h, graph, seriesNames);
        }, tracker);
      })  
      .then(() => {
        return h;
      });
};

export function joinAndAggregateStats(
    h: Hierarchy, stats:  StepStats) {
  // Get all the possible device names.
  let deviceNames:{[key:string]:boolean} = {};
  _.each(h.root.leaves(), nodeName => {
    let leaf = <OpNode> h.node(nodeName);
    if (leaf.device != null) {
      deviceNames[leaf.device] = true;
    }
  });
  h.devices = _.keys(deviceNames);

  // Reset stats for each group node.
  _.each(h.getNodeMap(), (node, nodeName) => {
    if (node.isGroupNode) {
      (<GroupNode>node).deviceHistogram = {};
    }
  });

  // Bubble-up the stats and device distribution from leaves to parents.
  _.each(h.root.leaves(), nodeName => {
    let leaf = <OpNode> h.node(nodeName);
    let node = <GroupNode|OpNode> leaf;
    while (node.parentNode != null) {
      if (leaf.device != null) {
        let deviceHistogram = (<GroupNode>node.parentNode).deviceHistogram;
        deviceHistogram[leaf.device] = (deviceHistogram[leaf.device] || 0) + 1;
      }
      node = <GroupNode> node.parentNode;
    }
  });
}

export function getIncompatibleOps(hierarchy: Hierarchy,
                                   hierarchyParams: HierarchyParams) {
  let nodes: (GroupNode | OpNode)[] = [];
  let addedSeriesNodes: { [seriesName: string]: SeriesNode } = {};
  _.each(hierarchy.root.leaves(), leaf => {
    let node = hierarchy.node(leaf);
    if (node.type == NodeType.OP) {
      let opNode = <OpNode> node;

      if (!opNode.compatible) {
        if (opNode.owningSeries) {
          if (hierarchyParams &&
              hierarchyParams.seriesMap[opNode.owningSeries]
              === graph.SeriesGroupingType.UNGROUP) {
            // For un-grouped series node, add each node individually
            nodes.push(opNode)
          } else {
            if (!addedSeriesNodes[opNode.owningSeries]) {
              let series = <SeriesNode>hierarchy.node(opNode.owningSeries);
              if (series) {
                addedSeriesNodes[opNode.owningSeries] = series;
                nodes.push(series);
              }
            }
          }
        } else {
          nodes.push(opNode);
        }
      }

      // Check the embeddings for invalid operations
      _.each(opNode.inEmbeddings, (inNode) => {
        if (!inNode.compatible) {
          nodes.push(inNode);
        }
      });

      _.each(opNode.outEmbeddings, (outNode) => {
        if (!outNode.compatible) {
          nodes.push(outNode);
        }
      });

    }
  });
  return nodes;
}


/**
 * Creates the metanodes in the hierarchical graph and assigns parent-child
 * relationship between them. Also assigns relationships between library
 * functions and their usages throughout the graph.
 */
function addNodes(h: Hierarchy, graph: SlimGraph) {
  // Maps the op of a node to names of nodes that have the op. Used to populate
  // the libraryFunctions field of the hierarchy.
  const opToNode:{[key:string]:any} = {};

  _.each(graph.nodes, (node, nodeName) => {
    let path = getHierarchicalPath(node.name);
    let parent: Metanode = h.root;

    parent.depth = Math.max(path.length, parent.depth);

    // Track which nodes are associated with which ops.
    if (!opToNode[node.op]) {
      opToNode[node.op] = [];
    }
    opToNode[node.op].push(node);

    // Create parent metanodes for each depth. For example if the node name
    // is 'a/b/c', then create metanodes 'a' and 'a/b', where 'a/b' is a child
    // of a.
    for (let i = 0; i < path.length; i++) {
      parent.depth = Math.max(parent.depth, path.length - i);
      parent.cardinality += node.cardinality;
      parent.opHistogram[node.op] = (parent.opHistogram[node.op] || 0) + 1;
      if (node.device != null) {
        parent.deviceHistogram[node.device] =
            (parent.deviceHistogram[node.device] || 0) + 1;
      }

      // Increment parents appropriate compatibility count
      if (node.compatible) {
        parent.compatibilityHistogram.compatible =
            (parent.compatibilityHistogram.compatible || 0) + 1;
      } else {
        parent.compatibilityHistogram.incompatible =
            (parent.compatibilityHistogram.incompatible || 0) + 1;
      }

      // Increment capability counts for in and out embeddings
      _.each(node.inEmbeddings, (inNode) => {
        if (inNode.compatible) {
          parent.compatibilityHistogram.compatible =
              (parent.compatibilityHistogram.compatible || 0) + 1;
        } else {
          parent.compatibilityHistogram.incompatible =
              (parent.compatibilityHistogram.incompatible || 0) + 1;
        }
      });

      _.each(node.outEmbeddings, (outNode) => {
        if (outNode.compatible) {
          parent.compatibilityHistogram.compatible =
              (parent.compatibilityHistogram.compatible || 0) + 1;
        } else {
          parent.compatibilityHistogram.incompatible =
              (parent.compatibilityHistogram.incompatible || 0) + 1;
        }
      });

      if (i === path.length - 1) { break; }
      let name = path[i];
      let child = <Metanode>h.node(name);
      if (!child) {
        child = createMetanode(name, h.graphOptions);
        child.parentNode = parent;
        h.setNode(name, child);
        parent.metagraph.setNode(name, child);

         
      }
      parent = child;
    }

    // Assuming node name is 'a/b/c', assign the OpNode as a child of the
    // metanode 'a/b'.
    h.setNode(node.name, node);
    node.parentNode = parent;
    parent.metagraph.setNode(node.name, node);

    // Add each of the in-embeddings and out-embeddings in the hierarchy.
    _.each(node.inEmbeddings, function(embedding) {
      h.setNode(embedding.name, embedding);
      embedding.parentNode = node;
    });
    _.each(node.outEmbeddings, function(embedding) {
      h.setNode(embedding.name, embedding);
      embedding.parentNode = node;
    });
  });
};

/**
 * For each metanode in the hierarchical graph, this method adds:
 * the edges in the metagraph. These are edges between nodes
 * that share the same parent.
 */
function addEdges(h: Hierarchy, graph: SlimGraph,
    seriesNames: { [name: string]: string }) {

  let nodeIndex = h.getNodeMap();

  // Ancestor paths for the source and destination nodes of an edge. These are
  // reused for each edge rather than allocating new ones. It's about 10% faster
  // than allocating new ones on each pass through the loop.
  let sourcePath: string[] = [];
  let destPath: string[] = [];

  // Insert the ancestor path for a node into the provided array, including the
  // node itself. Return the index of the last node inserted (always ROOT).
  let getPath = (node: graph.Node, path: string[]): number => {
    let i = 0;
    while (node) {
      path[i++] = node.name;
      node = node.parentNode;
    }
    return i - 1;
  };

  _.each(graph.edges, baseEdge => {

    // Get the hierarchical paths for the source and destination of the edge.
    let sourceAncestorIndex = getPath(graph.nodes[baseEdge.v], sourcePath);
    let destAncestorIndex = getPath(graph.nodes[baseEdge.w], destPath);

    // If the hierarchical path cannot be found for either endpoint, then we
    // cannot create the edge. This happens for example when a node has a
    // control dependency on a summary node, which are embedded.
    if (sourceAncestorIndex === -1 || destAncestorIndex === -1) {
      return;
    }

    // Find the lowest shared ancestor between source and dest by looking for
    // the highest nodes that differ between their ancestor paths.
    while (sourcePath[sourceAncestorIndex] === destPath[destAncestorIndex]) {
      sourceAncestorIndex--;
      destAncestorIndex--;
      if (sourceAncestorIndex < 0 || destAncestorIndex < 0) {
        // This would only occur if the two nodes were the same (a cycle in the
        // graph), or if one endpoint was a strict ancestor of the other. The
        // latter shouldn't happen because we rename nodes which are both
        // metanodes and op nodes. E.g. 'A/B' becomes 'A/B/(B)'.
        throw Error('No difference found between ancestor paths.');
      }
    }

    let sharedAncestorNode =
      <GroupNode>nodeIndex[sourcePath[sourceAncestorIndex + 1]];
    let sourceAncestorName = sourcePath[sourceAncestorIndex];
    let destAncestorName = destPath[destAncestorIndex];

    // Find or create the Metaedge which should contain this BaseEdge inside
    // the shared ancestor.
    let metaedge =
      sharedAncestorNode.metagraph.edge(sourceAncestorName, destAncestorName);
    if (!metaedge) {
      metaedge = createMetaedge(sourceAncestorName, destAncestorName);
      sharedAncestorNode.metagraph
        .setEdge(sourceAncestorName, destAncestorName, metaedge);
    }
    if (!sharedAncestorNode.hasNonControlEdges &&
        !baseEdge.isControlDependency) {
      sharedAncestorNode.hasNonControlEdges = true;
    }
    metaedge.addBaseEdge(baseEdge, h);
  });
};

/**
 * Using the hierarchy template information, detect series in the provided
 * metanode.  For each detected series, create a new SeriesNode
 * and remove series members from the metanode's metagraph and move them to
 * the new series node's metagraph.
 *
 * @param metanode
 * @param hierarchy
 * @param seriesNames Map of node names to their series they are contained in.
 *     This should be provided empty and is populated by this method.
 * @param threshold If the series has this many nodes or more, then group them
 *     into a series.
 * @param map Map of series names to their series grouping type, if one has
 *     been set.
 * @param useGeneralizedSeriesPatterns Whether to use find patterns for series
 *     nodes using any parts of names of nodes. If false, only uses patterns
 *     discovered within numeric suffixes of nodes names.
 * @return A dictionary from node name to series node name that contains the
 *     node.
 */
function groupSeries(metanode: Metanode, hierarchy: Hierarchy,
    seriesNames: { [name: string]: string }, threshold: number,
    map: { [name: string]:  SeriesGroupingType },
    useGeneralizedSeriesPatterns: boolean) {
  let metagraph = metanode.metagraph;
  _.each(metagraph.nodes(), n => {
    let child = metagraph.node(n);
    if (child.type ===  NodeType.META) {
      groupSeries(
          <Metanode>child,
          hierarchy,
          seriesNames,
          threshold,
          map,
          useGeneralizedSeriesPatterns);
    }
  });

  let clusters = clusterNodes(metagraph);

  const detectSeriesMethod = useGeneralizedSeriesPatterns?
      detectSeriesAnywhereInNodeName :
      detectSeriesUsingNumericSuffixes;
  let seriesDict = detectSeriesMethod(
      clusters, metagraph, hierarchy.graphOptions);

  // Add each series node to the graph and add its grouped children to its own
  // metagraph.
  _.each(seriesDict, function(seriesNode: SeriesNode, seriesName: string) {
    let nodeMemberNames = seriesNode.metagraph.nodes();
    _.each(nodeMemberNames, n => {
      let child = <OpNode>metagraph.node(n);
      if (!child.owningSeries) {
        child.owningSeries = seriesName;
      }
    });
    // If the series contains less than the threshold number of nodes and
    // this series has not been adding to the series map, then set this
    // series to be shown ungrouped in the map.
    if (nodeMemberNames.length < threshold && !(seriesNode.name in map)) {
      map[seriesNode.name] =  SeriesGroupingType.UNGROUP;
    }
    // If the series is in the map as ungrouped then do not group the series.
    if (seriesNode.name in map
      && map[seriesNode.name] ===  SeriesGroupingType.UNGROUP) {
      return;
    }
    hierarchy.setNode(seriesName, seriesNode); // add to the index
    metagraph.setNode(seriesName, seriesNode);
    _.each(nodeMemberNames, n => {
      let child = <OpNode> metagraph.node(n);
      seriesNode.metagraph.setNode(n, child);
      seriesNode.parentNode = child.parentNode;
      seriesNode.cardinality++;
      if (child.device != null) {
        seriesNode.deviceHistogram[child.device] =
            (seriesNode.deviceHistogram[child.device] || 0) + 1;
      }

      // Increment parents appropriate compatibility count
      if (child.compatible) {
        seriesNode.compatibilityHistogram.compatible =
            (seriesNode.compatibilityHistogram.compatible || 0) + 1;
      } else {
        seriesNode.compatibilityHistogram.incompatible =
            (seriesNode.compatibilityHistogram.incompatible || 0) + 1;
      }

      // Increment capability counts for in and out embeddings
      _.each(child.inEmbeddings, (inNode) => {
        if (inNode.compatible) {
          seriesNode.compatibilityHistogram.compatible =
              (seriesNode.compatibilityHistogram.compatible || 0) + 1;
        } else {
          seriesNode.compatibilityHistogram.incompatible =
              (seriesNode.compatibilityHistogram.incompatible || 0) + 1;
        }
      });

      _.each(child.outEmbeddings, (outNode) => {
        if (outNode.compatible) {
          seriesNode.compatibilityHistogram.compatible =
              (seriesNode.compatibilityHistogram.compatible || 0) + 1;
        } else {
          seriesNode.compatibilityHistogram.incompatible =
              (seriesNode.compatibilityHistogram.incompatible || 0) + 1;
        }
      });

      child.parentNode = seriesNode;
      seriesNames[n] = seriesName;
      // Remove now-grouped node from its original parent's metagraph.
      metagraph.removeNode(n);
    });
  });
};

/** cluster op-nodes with similar op */
function clusterNodes(metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>):
    {[clusterId: string]: string[]} {
  let result: {[clusterId: string]: string[]} = {};
  return  _.reduce(metagraph.nodes(),
      (clusters: {[clusterId: string]: string[]}, n: string) => {
    let child = metagraph.node(n);
    if (child.type === NodeType.META) {
      // skip metanodes
      return clusters;
    }
    let template = (<OpNode>child).op;
    if (template) {
      clusters[template] = clusters[template] || [];
      clusters[template].push(child.name);
    }
    return clusters;
  }, result);
}

/**
 * For each cluster of op-nodes based op type, try to detect groupings.
 * Infer series name using by trying to find pattern '<number>' towards the end
 * of node names.
 *
 * @param clusters Dictionary output from clusterNodes().
 * @param metagraph
 * @return A dictionary from series name => seriesNode
 */
function detectSeriesUsingNumericSuffixes(
    clusters: {[clusterId: string]: string[]},
    metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>,
    graphOptions: graphlib.GraphOptions):
     {[seriesName: string]: SeriesNode} {
  let seriesDict: {[seriesName: string]: SeriesNode} = {};
  _.each(clusters, function(members, clusterId: string) {
    if (members.length <= 1) { return; } // isolated clusters can't make series
    /** @type {Object}  A dictionary mapping seriesName to seriesInfoArray,
     * which is an array that contains objects with name, id, prefix, suffix,
     * and parent properties.
     */
    let candidatesDict: {[seriesName: string]: SeriesNode[]} = {};

    // Group all nodes that have the same name, with the exception of a
    // number at the end of the name after an underscore, which is allowed to
    // vary.
    _.each(members, function(name: string) {
      let isGroup = name.charAt(name.length - 1) === '*';
      let namepath = name.split('/');
      let leaf = namepath[namepath.length - 1];
      let parent = namepath.slice(0, namepath.length - 1).join('/');
      let matches = leaf.match(/^(\D*)_(\d+)$/);

      let prefix;
      let id;
      let suffix = '';
      if (matches) {         // if found '<number>' in the name, assign id.
        prefix = matches[1]; // the front non-numeric characters
        id = matches[2]; // the digits
      } else {  // for node without '_<number>', make them zero-th items.
        prefix = isGroup ? leaf.substr(0, leaf.length - 1) : leaf;
        id = 0;
        suffix = isGroup ? '*' : '';
      }
      let seriesName = getSeriesNodeName(prefix, suffix, parent);
      candidatesDict[seriesName] = candidatesDict[seriesName] || [];
      let seriesNode = createSeriesNode(
          prefix, suffix, parent, +id, name, graphOptions);
      candidatesDict[seriesName].push(seriesNode);
    });

    // In each group of nodes, group nodes in bunches that have monotonically
    // increasing numbers in their names.  Each of these bunches is a series.
    _.each(candidatesDict, function(seriesInfoArray: SeriesNode[], seriesName) {
      if (seriesInfoArray.length < 2) {
        return;
      }
      seriesInfoArray.sort(function(a, b) {
        return (+a.clusterId) - (+b.clusterId);
      });

      // Loop through the nodes sorted by its detected series number, grouping
      // all nodes with monotonically-increasing series numbers.
      let seriesNodes = [seriesInfoArray[0]];
      for (let index = 1; index < seriesInfoArray.length; index++) {
        let nextNode = seriesInfoArray[index];
        if (nextNode.clusterId === seriesNodes[seriesNodes.length - 1].clusterId
            + 1) {
          seriesNodes.push(nextNode);
          continue;
        }
        addSeriesToDict(
            seriesNodes, seriesDict, +clusterId, metagraph, graphOptions);
        seriesNodes = [nextNode];
      }
      addSeriesToDict(
          seriesNodes, seriesDict, +clusterId, metagraph, graphOptions);
    });
  });
  return seriesDict;
}

/**
 * For each cluster of op-nodes based op type, try to detect groupings.
 * Infer series name using by trying to find a pattern of numbers
 * anywhere within node names.
 *
 * @param clusters Dictionary output from clusterNodes().
 * @param metagraph
 * @return A dictionary from series name => seriesNode
 */
function detectSeriesAnywhereInNodeName(
    clusters: {[clusterId: string]: string[]},
    metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>,
    graphOptions: graphlib.GraphOptions):
     {[seriesName: string]: SeriesNode} {
  let seriesDict: {[seriesName: string]: SeriesNode} = {};
  _.each(clusters, function(members, clusterId: string) {
    if (members.length <= 1) { return; } // isolated clusters can't make series

    /**
     * @type {Object}  A dictionary mapping a series name to a SeriesNode.
     */
    let forwardDict: {[seriesName: string]: SeriesNode} = {};
    /**
     * @type {Object}  A dictionary mapping member name to an array of series
     * names this member could potentially be grouped under and the
     * corresponding ids.
     */
    let reverseDict: {[seriesName: string]: any[]} = {};

    // Group all nodes that have the same name, with the exception of a
    // number at the end of the name after an underscore, which is allowed to
    // vary.
    _.each(members, function(name: string) {
      let isGroup = name.charAt(name.length - 1) === '*';
      let namepath = name.split('/');
      let leaf:string = namepath[namepath.length - 1];
      let parent = namepath.slice(0, namepath.length - 1).join('/');

      const numRegex = /(\d+)/g;
      let matches = [];
      let matchResult;
      let prefix;
      let id:number;
      let suffix;
      let seriesName;
      let matched = 0;
      // Scan over the entire leaf name and match any possible numbers,
      // and put the results into corresponding dictionaries.
      while (matchResult = numRegex.exec(leaf)) {
        ++matched;
        prefix = leaf.slice(0, matchResult.index);
        id = parseInt( matchResult[0]);
        suffix = leaf.slice(matchResult.index + matchResult[0].length);
        seriesName = getSeriesNodeName(prefix, suffix, parent);
        forwardDict[seriesName] = forwardDict[seriesName];
        if (!forwardDict[seriesName]) {
          forwardDict[seriesName] = createSeriesNode(
            prefix, suffix, parent, +id, name, graphOptions);
        }
        forwardDict[seriesName].ids.push(id);
        reverseDict[name] = reverseDict[name] || [];
        reverseDict[name].push([seriesName, id]);
      }
      if (matched < 1) {
        prefix = isGroup ? leaf.substr(0, leaf.length - 1) : leaf;
        id = 0;
        suffix = isGroup ? '*' : '';
        seriesName = getSeriesNodeName(prefix, suffix, parent);
        forwardDict[seriesName] = forwardDict[seriesName];
        if (!forwardDict[seriesName]) {
          forwardDict[seriesName] = createSeriesNode(
            prefix, suffix, parent, +id, name, graphOptions);
        }
        forwardDict[seriesName].ids.push(id);
        reverseDict[name] = reverseDict[name] || [];
        reverseDict[name].push([seriesName, id]);
      }
    });
    /** @type {Object}  A dictionary mapping seriesName to seriesInfoArray,
     * which is an array that contains objects with name, id, prefix, suffix,
     * and parent properties.
     */
    var candidatesDict: {[seriesName: string]: SeriesNode[]} = {};
    // For each of the member, put it into the maximum possible series,
    // and create candidatesDict accordingly.
    _.each(reverseDict, function (seriesNameIdArray, name) {
      seriesNameIdArray.sort(function (a, b) {
          return (forwardDict[b[0]].ids.length) - (forwardDict[a[0]].ids.length);
      });
      var seriesName = seriesNameIdArray[0][0];
      var id = seriesNameIdArray[0][1];
      candidatesDict[seriesName] = candidatesDict[seriesName] || [];
      const namepath = name.split('/');
      const leaf = namepath[namepath.length - 1];
      const parent = namepath.slice(0, namepath.length - 1).join('/');
      var seriesNode = createSeriesNode(
          forwardDict[seriesName].prefix,
          forwardDict[seriesName].suffix,
          parent,
          +id,
          name,
          graphOptions);
      candidatesDict[seriesName].push(seriesNode);
    });

    // In each group of nodes, group nodes in bunches that have monotonically
    // increasing numbers in their names.  Each of these bunches is a series.
    _.each(candidatesDict, function(seriesInfoArray: SeriesNode[], seriesName) {
      if (seriesInfoArray.length < 2) {
        return;
      }
      seriesInfoArray.sort(function(a, b) {
        return (+a.clusterId) - (+b.clusterId);
      });

      // Loop through the nodes sorted by its detected series number, grouping
      // all nodes with monotonically-increasing series numbers.
      let seriesNodes = [seriesInfoArray[0]];
      for (let index = 1; index < seriesInfoArray.length; index++) {
        let nextNode = seriesInfoArray[index];
        if (nextNode.clusterId === seriesNodes[seriesNodes.length - 1].clusterId
            + 1) {
          seriesNodes.push(nextNode);
          continue;
        }
        addSeriesToDict(
            seriesNodes, seriesDict, +clusterId, metagraph, graphOptions);
        seriesNodes = [nextNode];
      }
      addSeriesToDict(
          seriesNodes, seriesDict, +clusterId, metagraph, graphOptions);
    });
  });
  return seriesDict;
}

/**
 * Add a series to the provided dictionary mapping series names to series.
 *
 * @param seriesNodes the nodes in the series. Contains
 *     name, id, prefix, suffix and parent properties of the node.
 * @param seriesDict the dictionary of series
 * @param clusterId ID of the template of the nodes of the series
 * @param metagraph
 * @param graphOptions
 */
function addSeriesToDict(seriesNodes: SeriesNode[],
    seriesDict: {[seriesName: string]: SeriesNode},
    clusterId: number,
    metagraph: graphlib.Graph<GroupNode|OpNode, Metaedge>,
    graphOptions: graphlib.GraphOptions) {
  if (seriesNodes.length > 1) {
    let curSeriesName = getSeriesNodeName(
      seriesNodes[0].prefix, seriesNodes[0].suffix,
      seriesNodes[0].parent, seriesNodes[0].clusterId,
      seriesNodes[seriesNodes.length - 1].clusterId);
    let curSeriesNode = createSeriesNode(seriesNodes[0].prefix,
      seriesNodes[0].suffix, seriesNodes[0].parent, clusterId,
      curSeriesName, graphOptions);
    _.each(seriesNodes, function(node) {
      curSeriesNode.ids.push(node.clusterId);
      curSeriesNode.metagraph.setNode(node.name, metagraph.node(node.name));
    });
    seriesDict[curSeriesName] = curSeriesNode;
  }
}

 
