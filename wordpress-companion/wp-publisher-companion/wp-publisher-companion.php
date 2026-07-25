<?php
/**
 * Plugin Name: WP Publisher Companion
 * Plugin URI: https://github.com/irisable/wp-publisher-for-obsidian
 * Description: Lets WP Publisher for Obsidian read and update allowed metadata over authenticated REST and XML-RPC.
 * Version: 0.4.1
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Irisable
 * Author URI: https://github.com/irisable
 * License: Apache-2.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const WP_PUBLISHER_COMPANION_VERSION = '0.4.1';

/**
 * Add the companion methods to WordPress XML-RPC.
 *
 * @param array<string, callable> $methods Registered XML-RPC methods.
 * @return array<string, callable>
 */
function wp_publisher_companion_xmlrpc_methods( $methods ) {
	$methods['wpPublisher.getCapabilities']      = 'wp_publisher_companion_get_capabilities';
	$methods['wpPublisher.updateSeoMeta']         = 'wp_publisher_companion_update_seo_meta';
	$methods['wpPublisher.getSeoMeta']            = 'wp_publisher_companion_get_seo_meta';
	$methods['wpPublisher.getSecondaryTitle']     = 'wp_publisher_companion_get_secondary_title';
	$methods['wpPublisher.updateSecondaryTitle']  = 'wp_publisher_companion_update_secondary_title';
	$methods['wpPublisher.updateMediaMetadata']    = 'wp_publisher_companion_update_media_metadata';
	return $methods;
}
add_filter( 'xmlrpc_methods', 'wp_publisher_companion_xmlrpc_methods' );

/** Register authenticated REST endpoints for capability and metadata access. */
function wp_publisher_companion_register_rest_routes() {
	register_rest_route(
		'wp-publisher/v1',
		'/capabilities',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'wp_publisher_companion_rest_capabilities',
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
	register_rest_route(
		'wp-publisher/v1',
		'/posts/(?P<id>\d+)/seo',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'wp_publisher_companion_rest_get_seo',
				'permission_callback' => 'wp_publisher_companion_rest_can_edit_post',
			),
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => 'wp_publisher_companion_rest_update_seo',
				'permission_callback' => 'wp_publisher_companion_rest_can_edit_post',
			),
		)
	);
	register_rest_route(
		'wp-publisher/v1',
		'/posts/(?P<id>\d+)/secondary-title',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'wp_publisher_companion_rest_get_secondary_title',
				'permission_callback' => 'wp_publisher_companion_rest_can_edit_post',
			),
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => 'wp_publisher_companion_rest_update_secondary_title',
				'permission_callback' => 'wp_publisher_companion_rest_can_edit_post',
			),
		)
	);
}
add_action( 'rest_api_init', 'wp_publisher_companion_register_rest_routes' );

/** @param WP_REST_Request $request REST request. */
function wp_publisher_companion_rest_can_edit_post( $request ) {
	$post_id = absint( $request['id'] );
	if ( ! $post_id || ! get_post( $post_id ) ) {
		return new WP_Error( 'wp_publisher_missing_post', 'Post not found.', array( 'status' => 404 ) );
	}
	return current_user_can( 'edit_post', $post_id );
}

/** Return companion capabilities to an authenticated editor. */
function wp_publisher_companion_rest_capabilities() {
	return rest_ensure_response(
		array(
			'version'            => WP_PUBLISHER_COMPANION_VERSION,
			'rankMathSeo'        => wp_publisher_companion_has_rank_math(),
			'rankMathSeoRead'    => wp_publisher_companion_has_rank_math(),
			'secondaryTitle'     => wp_publisher_companion_has_secondary_title(),
			'secondaryTitleRead' => wp_publisher_companion_has_secondary_title(),
			'mediaMetadata'      => true,
		)
	);
}

/** @param WP_REST_Request $request REST request. */
function wp_publisher_companion_rest_get_seo( $request ) {
	if ( ! wp_publisher_companion_has_rank_math() ) {
		return new WP_Error( 'wp_publisher_rank_math_missing', 'Rank Math is not active.', array( 'status' => 409 ) );
	}
	$post_id = absint( $request['id'] );
	return rest_ensure_response(
		array(
			'focusKeyword'    => (string) get_post_meta( $post_id, 'rank_math_focus_keyword', true ),
			'metaDescription' => (string) get_post_meta( $post_id, 'rank_math_description', true ),
		)
	);
}

/** @param WP_REST_Request $request REST request. */
function wp_publisher_companion_rest_update_seo( $request ) {
	if ( ! wp_publisher_companion_has_rank_math() ) {
		return new WP_Error( 'wp_publisher_rank_math_missing', 'Rank Math is not active.', array( 'status' => 409 ) );
	}
	$post_id    = absint( $request['id'] );
	$parameters = $request->get_json_params();
	$fields     = array(
		'rank_math_focus_keyword' => 'sanitize_text_field',
		'rank_math_description'   => 'sanitize_textarea_field',
	);
	$updated    = array();
	foreach ( $fields as $key => $sanitizer ) {
		if ( ! is_array( $parameters ) || ! array_key_exists( $key, $parameters ) ) {
			continue;
		}
		$value = call_user_func( $sanitizer, (string) $parameters[ $key ] );
		if ( '' === $value ) {
			delete_post_meta( $post_id, $key );
		} else {
			update_post_meta( $post_id, $key, $value );
		}
		$updated[] = $key;
	}
	return rest_ensure_response( array( 'postId' => (string) $post_id, 'updated' => $updated ) );
}

/** @param WP_REST_Request $request REST request. */
function wp_publisher_companion_rest_get_secondary_title( $request ) {
	if ( ! wp_publisher_companion_has_secondary_title() ) {
		return new WP_Error( 'wp_publisher_secondary_title_missing', 'Secondary Title is not active.', array( 'status' => 409 ) );
	}
	$post_id = absint( $request['id'] );
	return rest_ensure_response(
		array(
			'secondaryTitle' => (string) get_post_meta( $post_id, '_secondary_title', true ),
		)
	);
}

/** @param WP_REST_Request $request REST request. */
function wp_publisher_companion_rest_update_secondary_title( $request ) {
	if ( ! wp_publisher_companion_has_secondary_title() ) {
		return new WP_Error( 'wp_publisher_secondary_title_missing', 'Secondary Title is not active.', array( 'status' => 409 ) );
	}
	$parameters = $request->get_json_params();
	if ( ! is_array( $parameters ) || ! array_key_exists( '_secondary_title', $parameters ) ) {
		return new WP_Error( 'wp_publisher_secondary_title_required', 'A secondary title value is required.', array( 'status' => 400 ) );
	}
	$post_id = absint( $request['id'] );
	$value   = sanitize_text_field( (string) $parameters['_secondary_title'] );
	if ( '' === $value ) {
		delete_post_meta( $post_id, '_secondary_title' );
	} else {
		update_post_meta( $post_id, '_secondary_title', $value );
	}
	return rest_ensure_response(
		array(
			'postId'  => (string) $post_id,
			'updated' => array( '_secondary_title' ),
		)
	);
}

/**
 * Authenticate an XML-RPC request using the normal WordPress credentials.
 *
 * @param array<int, mixed> $args XML-RPC arguments.
 * @return WP_User|IXR_Error
 */
function wp_publisher_companion_authenticate( $args ) {
	global $wp_xmlrpc_server;

	if ( ! is_array( $args ) || count( $args ) < 3 ) {
		return new IXR_Error( 400, 'Invalid companion request.' );
	}

	$user = $wp_xmlrpc_server->login( (string) $args[1], (string) $args[2] );
	if ( ! $user ) {
		return new IXR_Error( 403, 'Authentication failed.' );
	}

	return $user;
}

/**
 * Whether Rank Math is available for SEO metadata updates.
 *
 * @return bool
 */
function wp_publisher_companion_has_rank_math() {
	return defined( 'RANK_MATH_VERSION' ) || class_exists( 'RankMath\\Helper' );
}

/**
 * Whether the Secondary Title plugin is available for post metadata updates.
 *
 * @return bool
 */
function wp_publisher_companion_has_secondary_title() {
	return function_exists( 'get_secondary_title' );
}

/**
 * Report companion capabilities after authentication.
 *
 * @param array<int, mixed> $args XML-RPC arguments.
 * @return array<string, mixed>|IXR_Error
 */
function wp_publisher_companion_get_capabilities( $args ) {
	$user = wp_publisher_companion_authenticate( $args );
	if ( is_wp_error( $user ) || $user instanceof IXR_Error ) {
		return $user;
	}

	return array(
		'version'            => WP_PUBLISHER_COMPANION_VERSION,
		'rankMathSeo'        => wp_publisher_companion_has_rank_math(),
		'rankMathSeoRead'    => wp_publisher_companion_has_rank_math(),
		'secondaryTitle'     => wp_publisher_companion_has_secondary_title(),
		'secondaryTitleRead' => wp_publisher_companion_has_secondary_title(),
		'mediaMetadata'      => true,
	);
}

/**
 * Read the two Rank Math fields supported by WP Publisher.
 *
 * @param array<int, mixed> $args XML-RPC arguments.
 * @return array<string, string>|IXR_Error
 */
function wp_publisher_companion_get_seo_meta( $args ) {
	$user = wp_publisher_companion_authenticate( $args );
	if ( is_wp_error( $user ) || $user instanceof IXR_Error ) {
		return $user;
	}
	if ( count( $args ) < 4 ) {
		return new IXR_Error( 400, 'A post ID is required.' );
	}

	$post_id = absint( $args[3] );
	if ( ! $post_id || ! get_post( $post_id ) ) {
		return new IXR_Error( 404, 'Post not found.' );
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return new IXR_Error( 403, 'You are not allowed to edit this post.' );
	}
	if ( ! wp_publisher_companion_has_rank_math() ) {
		return new IXR_Error( 409, 'Rank Math is not active.' );
	}

	return array(
		'focusKeyword'    => (string) get_post_meta( $post_id, 'rank_math_focus_keyword', true ),
		'metaDescription' => (string) get_post_meta( $post_id, 'rank_math_description', true ),
	);
}

/**
 * Update only the Rank Math fields supported by WP Publisher.
 *
 * @param array<int, mixed> $args XML-RPC arguments.
 * @return array<string, mixed>|IXR_Error
 */
function wp_publisher_companion_update_seo_meta( $args ) {
	$user = wp_publisher_companion_authenticate( $args );
	if ( is_wp_error( $user ) || $user instanceof IXR_Error ) {
		return $user;
	}
	if ( count( $args ) < 5 || ! is_array( $args[4] ) ) {
		return new IXR_Error( 400, 'A post ID and metadata object are required.' );
	}

	$post_id = absint( $args[3] );
	if ( ! $post_id || ! get_post( $post_id ) ) {
		return new IXR_Error( 404, 'Post not found.' );
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return new IXR_Error( 403, 'You are not allowed to edit this post.' );
	}
	if ( ! wp_publisher_companion_has_rank_math() ) {
		return new IXR_Error( 409, 'Rank Math is not active.' );
	}

	$meta       = $args[4];
	$sanitizers = array(
		'rank_math_focus_keyword' => 'sanitize_text_field',
		'rank_math_description'   => 'sanitize_textarea_field',
	);
	$updated    = array();

	foreach ( $sanitizers as $key => $sanitizer ) {
		if ( ! array_key_exists( $key, $meta ) ) {
			continue;
		}
		$value = call_user_func( $sanitizer, (string) $meta[ $key ] );
		if ( '' === $value ) {
			delete_post_meta( $post_id, $key );
		} else {
			update_post_meta( $post_id, $key, $value );
		}
		$updated[] = $key;
	}

	return array(
		'postId'  => (string) $post_id,
		'updated' => $updated,
	);
}

/**
 * Read the Secondary Title value for one editable post.
 *
 * @param array<int, mixed> $args XML-RPC arguments.
 * @return array<string, string>|IXR_Error
 */
function wp_publisher_companion_get_secondary_title( $args ) {
	$user = wp_publisher_companion_authenticate( $args );
	if ( is_wp_error( $user ) || $user instanceof IXR_Error ) {
		return $user;
	}
	if ( count( $args ) < 4 ) {
		return new IXR_Error( 400, 'A post ID is required.' );
	}

	$post_id = absint( $args[3] );
	if ( ! $post_id || ! get_post( $post_id ) ) {
		return new IXR_Error( 404, 'Post not found.' );
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return new IXR_Error( 403, 'You are not allowed to edit this post.' );
	}
	if ( ! wp_publisher_companion_has_secondary_title() ) {
		return new IXR_Error( 409, 'Secondary Title is not active.' );
	}

	return array(
		'secondaryTitle' => (string) get_post_meta( $post_id, '_secondary_title', true ),
	);
}

/**
 * Update the Secondary Title value for one editable post.
 *
 * @param array<int, mixed> $args XML-RPC arguments.
 * @return array<string, mixed>|IXR_Error
 */
function wp_publisher_companion_update_secondary_title( $args ) {
	$user = wp_publisher_companion_authenticate( $args );
	if ( is_wp_error( $user ) || $user instanceof IXR_Error ) {
		return $user;
	}
	if ( count( $args ) < 5 || ! is_array( $args[4] ) || ! array_key_exists( '_secondary_title', $args[4] ) ) {
		return new IXR_Error( 400, 'A post ID and secondary title value are required.' );
	}

	$post_id = absint( $args[3] );
	if ( ! $post_id || ! get_post( $post_id ) ) {
		return new IXR_Error( 404, 'Post not found.' );
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return new IXR_Error( 403, 'You are not allowed to edit this post.' );
	}
	if ( ! wp_publisher_companion_has_secondary_title() ) {
		return new IXR_Error( 409, 'Secondary Title is not active.' );
	}

	$value = sanitize_text_field( (string) $args[4]['_secondary_title'] );
	if ( '' === $value ) {
		delete_post_meta( $post_id, '_secondary_title' );
	} else {
		update_post_meta( $post_id, '_secondary_title', $value );
	}

	return array(
		'postId'  => (string) $post_id,
		'updated' => array( '_secondary_title' ),
	);
}

/**
 * Update a strict allowlist of WordPress attachment fields.
 *
 * @param array<int, mixed> $args XML-RPC arguments.
 * @return array<string, mixed>|IXR_Error
 */
function wp_publisher_companion_update_media_metadata( $args ) {
	$user = wp_publisher_companion_authenticate( $args );
	if ( is_wp_error( $user ) || $user instanceof IXR_Error ) {
		return $user;
	}
	if ( count( $args ) < 5 || ! is_array( $args[4] ) ) {
		return new IXR_Error( 400, 'An attachment ID and metadata object are required.' );
	}

	$attachment_id = absint( $args[3] );
	if ( ! $attachment_id || 'attachment' !== get_post_type( $attachment_id ) ) {
		return new IXR_Error( 404, 'Attachment not found.' );
	}
	if ( ! current_user_can( 'edit_post', $attachment_id ) ) {
		return new IXR_Error( 403, 'You are not allowed to edit this attachment.' );
	}

	$meta    = $args[4];
	$updated = array();
	$post    = array( 'ID' => $attachment_id );
	$fields  = array(
		'title'       => array( 'post_title', 'sanitize_text_field' ),
		'caption'     => array( 'post_excerpt', 'wp_kses_post' ),
		'description' => array( 'post_content', 'wp_kses_post' ),
	);
	foreach ( $fields as $key => $definition ) {
		if ( ! array_key_exists( $key, $meta ) ) {
			continue;
		}
		$post[ $definition[0] ] = call_user_func( $definition[1], (string) $meta[ $key ] );
		$updated[]              = $key;
	}
	if ( count( $post ) > 1 ) {
		$result = wp_update_post( $post, true );
		if ( is_wp_error( $result ) ) {
			return new IXR_Error( 500, $result->get_error_message() );
		}
	}
	if ( array_key_exists( 'alt', $meta ) ) {
		update_post_meta(
			$attachment_id,
			'_wp_attachment_image_alt',
			sanitize_text_field( (string) $meta['alt'] )
		);
		$updated[] = 'alt';
	}

	return array(
		'attachmentId' => (string) $attachment_id,
		'updated'      => $updated,
	);
}
